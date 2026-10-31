/**
 * Native video and audio reading for models that declare media input.
 *
 * Pi tool results only carry text and images, so the extension registers a
 * read tool that records a media ref, tags the serialized tool result with a
 * marker, and rewrites that marker into a native provider content part before
 * the request is sent. Capabilities come from the model entry in models.json:
 *
 * ```json
 * { "id": "XiaomiMiMo/MiMo-V2.6-Pro", "media": { "video": true, "audio": true } }
 * ```
 */

import { join } from "node:path";

import {
  type BeforeProviderRequestEvent,
  type ContextEvent,
  createReadToolDefinition,
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  type ReadToolDetails,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

import {
  NO_MEDIA_CAPABILITIES,
  type ResolvedModelMedia,
  resolveModelMedia,
} from "../core/capabilities.ts";
import {
  cleanMediaMarkers,
  type MediaRef,
  mediaKind,
  omitMediaMarkers,
  rewriteMediaPayload,
} from "../core/media.ts";
import { tagMediaToolResults } from "./attachments.ts";
import {
  createMediaRef,
  ModelsConfigReader,
  prepareTransport,
  resolveMediaPath,
} from "./files.ts";

const MEDIA_TOOL_DESCRIPTION =
  "Reads video and audio files directly when the selected model declares media input. The file is attached natively to the next request; video is downscaled to a 640px H.264 preview and its audio track is attached too when the model accepts audio.";

type MediaToolDetails = ReadToolDetails & { readonly media: MediaRef };
type MediaReadDetails = ReadToolDetails | MediaToolDetails | undefined;

export default function mediaExtension(pi: ExtensionAPI): void {
  const configReader = new ModelsConfigReader(
    join(getAgentDir(), "models.json"),
  );
  const builtin = createReadToolDefinition(process.cwd());
  let refs = new Map<string, MediaRef>();

  const mediaFor = async (
    ctx: ExtensionContext,
  ): Promise<ResolvedModelMedia> => {
    const model = ctx.model;
    if (!model) return { capabilities: NO_MEDIA_CAPABILITIES };
    return resolveModelMedia(
      await configReader.read(),
      model.provider,
      model.id,
    );
  };

  const definition: ToolDefinition<
    typeof builtin.parameters,
    MediaReadDetails
  > = {
    ...builtin,
    description: `${builtin.description} ${MEDIA_TOOL_DESCRIPTION}`,
    async execute(id, params, signal, onUpdate, ctx) {
      const input = params.path.startsWith("@")
        ? params.path.slice(1)
        : params.path;
      const kind = mediaKind(input);
      if (!kind) return builtin.execute(id, params, signal, onUpdate, ctx);
      if (params.offset !== undefined || params.limit !== undefined) {
        throw new Error(
          "offset and limit do not apply to video or audio files.",
        );
      }
      const { capabilities, maxRequestBytes } = await mediaFor(ctx);
      const enabled =
        kind === "video" ? capabilities.video : capabilities.audio;
      if (!enabled) {
        throw new Error(
          `The selected model does not declare ${kind} input. Add "media": { "${kind}": true } to its model entry in models.json and reload.`,
        );
      }
      const path = resolveMediaPath(input, ctx.cwd);
      const ref = await createMediaRef(path, kind, signal);
      let transportBytes: number | undefined;
      if (kind === "video") {
        onUpdate?.({
          content: [
            {
              type: "text",
              text: "Preparing video preview for the selected model...",
            },
          ],
          details: undefined,
        });
        const transport = await prepareTransport(ref, {
          signal,
          includeAudio: capabilities.audio !== false,
        });
        transportBytes =
          transport.data.length + (transport.audio?.data.length ?? 0);
      }
      if (maxRequestBytes !== undefined) {
        const bytes = transportBytes ?? ref.size;
        if (base64Length(bytes) > maxRequestBytes) {
          throw new Error(
            `Media exceeds the model's declared inputLimits.maxRequestBytes (${maxRequestBytes}).`,
          );
        }
      }
      return {
        content: [
          {
            type: "text",
            text: `Read ${kind} ${ref.path}. The file is attached natively to the next model request.`,
          },
        ],
        details: { media: ref },
      };
    },
  };
  pi.registerTool(definition);

  pi.on("context", async (event: ContextEvent) => {
    const tagged = tagMediaToolResults(event.messages);
    refs = tagged.refs;
    return { messages: tagged.messages };
  });

  pi.on(
    "before_provider_request",
    async (event: BeforeProviderRequestEvent, ctx: ExtensionContext) => {
      const requestRefs = refs;
      if (requestRefs.size === 0) return cleanMediaMarkers(event.payload);
      const model = ctx.model;
      if (!model || model.api !== "openai-completions") {
        return omitMediaMarkers(
          event.payload,
          requestRefs,
          "media input is only implemented for OpenAI-compatible models",
        );
      }
      const { capabilities, maxRequestBytes } = await mediaFor(ctx);
      try {
        const rewritten = await rewriteMediaPayload(
          event.payload,
          requestRefs,
          capabilities,
          async (ref) =>
            prepareTransport(ref, {
              signal: ctx.signal,
              includeAudio: capabilities.audio !== false,
            }),
        );
        if (
          maxRequestBytes !== undefined &&
          serializedBytes(rewritten) > maxRequestBytes
        ) {
          return omitMediaMarkers(
            event.payload,
            requestRefs,
            `request exceeds the model's declared inputLimits.maxRequestBytes (${maxRequestBytes})`,
          );
        }
        return rewritten;
      } catch (error) {
        const reason =
          error instanceof Error
            ? error.message
            : "media could not be attached";
        return omitMediaMarkers(event.payload, requestRefs, reason);
      }
    },
  );
}

function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

function serializedBytes(payload: unknown): number {
  return Buffer.byteLength(JSON.stringify(payload));
}
