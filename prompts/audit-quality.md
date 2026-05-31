# GRASP/ATAM Architecture Quality Audit Prompt

You are auditing a software codebase as a senior architecture reviewer. Produce evidence-backed findings from project documentation, source code, tests, dependency structure, and validation commands. Evaluate architecture quality with a GRASP-based rubric, complemented by ATAM, ISO/IEC 25010 Maintainability, and an analytic scoring rubric.

## Methodological references

Apply these references as audit methods, not as citations only:

1. CMU SEI Architecture Tradeoff Analysis Method (ATAM)
   - Evaluate the architecture against concrete quality goals such as maintainability, reliability, portability, security, performance, and operability.
   - For each major risk, describe the scenario, stimulus, affected component, observed weakness, expected response, impact, sensitivity points, and tradeoffs.
   - Produce actionable findings grounded in files, packages, commands, or runtime behavior.

2. ISO/IEC 25010 Maintainability
   - Score maintainability using observable evidence for modularity, analyzability, modifiability, and testability.
   - Do not use maintainability as a vague synonym for “clean code”. Tie each claim to code structure, tests, and change impact.

3. GRASP
   - Information Expert
   - Controller
   - Creator
   - Low Coupling
   - High Cohesion
   - Polymorphism
   - Indirection
   - Protected Variations
   - Pure Fabrication

4. Analytic rubric
   - Score each criterion separately.
   - Use the common scale below for every criterion.
   - If weights differ from the default weighting, explain the rationale.

Reference links:

- CMU SEI, Architecture Tradeoff Analysis Method Collection  
  https://www.sei.cmu.edu/library/architecture-tradeoff-analysis-method-collection/
- ISO/IEC 25010, Maintainability  
  https://iso25000.com/index.php/en/iso-25000-standards/iso-25010/57-maintainability
- GRASP overview  
  https://en.wikipedia.org/wiki/GRASP_(object-oriented_design)
- Primary GRASP source, when available: Craig Larman, *Applying UML and Patterns*
- DePaul, Analytic Rubrics  
  https://resources.depaul.edu/teaching-commons/teaching-guides/feedback-grading/rubrics/Pages/types-of-rubrics.aspx

## Default scoring

Use this 0 to 5 scale:

- 0: absent. No evidence that the criterion is addressed.
- 1: harmful. The design repeatedly violates the criterion and creates concrete risk.
- 2: weak. Some local examples exist, but violations are common or important.
- 3: adequate. The criterion is mostly satisfied, with visible gaps or uneven application.
- 4: strong. The criterion is consistently satisfied, with minor exceptions.
- 5: excellent. The criterion is deliberately enforced by design, tests, and conventions.

Use this default weighting unless project constraints justify another one:

- GRASP criteria: 70% of the global score.
- ISO/IEC 25010 Maintainability criteria: 20% of the global score.
- Validation and test evidence: 10% of the global score.

Global score formula:

```text
global = 0.70 * average(GRASP scores) / 5 * 100
       + 0.20 * average(ISO maintainability scores) / 5 * 100
       + 0.10 * validation evidence score / 5 * 100
```

Also provide a letter grade:

- A: 90-100
- B: 80-89
- C: 70-79
- D: 60-69
- F: below 60

## Audit method

1. Audit project documentation first:
   - README
   - docs/
   - architecture or specification files
   - ADRs, design notes, issue specs, or planning files
   - agent or contributor conventions
   - CI workflows and release workflows

2. Discover validation commands before running them:
   - README commands
   - Makefile targets
   - package scripts
   - CI workflow commands
   - language-specific tooling files
   - project-specific scripts

3. Audit structure:
   - packages or modules
   - import graph
   - fan-in and fan-out
   - cycles
   - entry points
   - public/internal boundaries
   - architecture or import-boundary tests
   - module visibility rules

4. Audit code:
   - responsibilities by package or module
   - top 10 largest production files
   - top fan-in and fan-out packages
   - cycles or suspicious coupling
   - behavioral duplication
   - excessive dynamic types, globals, or hidden shared state
   - lifecycle ownership for processes, sockets, files, goroutines, tasks, threads, and external resources
   - concurrency safety and cancellation paths
   - error wrapping, error classification, and observability

5. Audit tests:
   - behavioral coverage of public contracts, not only line coverage
   - unit, integration, and end-to-end tests
   - hermeticity: no leaked processes, ports, sockets, temp files, caches, or environment changes
   - flakiness: repeat relevant tests when cheap, for example with `-count`
   - architecture boundary verification
   - failure-path and cleanup-path coverage

6. Run the safest relevant validation commands:
   - tests
   - race or concurrency checks when relevant
   - lint
   - format checks
   - build
   - dependency or vulnerability checks
   - stack-specific checks

If a validation command is not run, state why. Do not infer green status from CI badges alone.

## GRASP scoring criteria

Score these GRASP criteria:

- Information Expert: behavior lives near the data and context needed to perform it.
  - Red flags: controllers performing domain work, duplicated knowledge, data-only modules with external procedural logic.
- Controller: controllers translate external intent into application requests without owning domain, process, protocol, persistence, mutation, or backend-specific logic.
  - Red flags: CLI/API/controller packages with high fan-out and business rules.
- Creator: ownership of creation, lifecycle, and cleanup is explicit for resources and objects a module aggregates or closely uses.
  - Red flags: leaked processes, unclear shutdown, constructors far from owners, hidden global initialization.
- Low Coupling: dependencies are limited, directional, and stable. Interfaces exist at ownership boundaries, not as premature abstraction.
  - Red flags: concrete cross-feature imports, cycles, import fan-out spikes, shared packages importing concrete implementations.
- High Cohesion: modules have one stable reason to change.
  - Red flags: packages mixing protocol, process, config, output, persistence, and business behavior.
- Polymorphism: variation is expressed through interfaces, typed dispatch, registries, or strategy objects rather than scattered conditionals.
  - Red flags: repeated `switch` or `if` chains over type/backend/provider/format across unrelated packages.
- Indirection: I/O, processes, network, databases, external APIs, and clocks have testable seams.
  - Red flags: direct hard-coded external calls in business logic, tests requiring real services without opt-in.
- Protected Variations: unstable external contracts are isolated behind adapters and translated into stable internal contracts.
  - Red flags: third-party protocol details leaking into shared packages or public APIs.
- Pure Fabrication: technical service packages are named by responsibility and cohesive.
  - Red flags: grab-bag `utils`, `helpers`, `common`, or `tools` packages with unrelated behavior.

## ISO/IEC 25010 Maintainability criteria

Score these maintainability criteria:

- Modularity: components are discrete, and changes to one component have minimal impact on others.
- Analyzability: a reviewer can locate behavior, failure causes, and change impact quickly.
- Modifiability: changes can be made without broad edits, regressions, or public contract breakage.
- Testability: behavior and failure modes can be verified with deterministic tests and explicit seams.

## ATAM risk format

For every P0 or P1 risk, include this structure:

```text
Risk: <short name>
Priority: P0|P1
Scenario: <quality attribute scenario>
Stimulus: <event or change that triggers the risk>
Affected components: <files/packages/modules>
Observed weakness: <evidence from code/tests/commands>
Expected response: <what the architecture should make possible>
Impact: <user, maintainer, runtime, security, or delivery impact>
Sensitivity points: <decisions that strongly affect the outcome, or "none found">
Tradeoffs: <quality tradeoffs, or "none found">
Recommendation: <smallest useful action>
Validation: <commands/tests/proofs expected>
```

For P2 and P3 risks, include at least priority, impact, recommendation, and validation.

## Expected output format

Use this structure exactly unless the user asks for another format.

### 1. Executive summary

- Global score: `<score>/100`
- Grade: `<A|B|C|D|F>`
- Level: `<excellent|good|average|weak|poor>`
- Confidence: `<high|medium|low>`
- Verdict: `<short factual verdict>`
- Blocked by: `<missing access, missing commands, or none>`

### 2. Score table

| Criterion | Score /5 | Weight group | Evidence | Justification |
|---|---:|---|---|---|
| Information Expert |  | GRASP |  |  |
| Controller |  | GRASP |  |  |
| Creator |  | GRASP |  |  |
| Low Coupling |  | GRASP |  |  |
| High Cohesion |  | GRASP |  |  |
| Polymorphism |  | GRASP |  |  |
| Indirection |  | GRASP |  |  |
| Protected Variations |  | GRASP |  |  |
| Pure Fabrication |  | GRASP |  |  |
| Modularity |  | ISO 25010 |  |  |
| Analyzability |  | ISO 25010 |  |  |
| Modifiability |  | ISO 25010 |  |  |
| Testability |  | ISO 25010 |  |  |
| Validation evidence |  | Validation |  |  |

### 3. Main strengths

List 3 to 7 strengths. Include file paths or package names for each.

### 4. Main risks

List risks by priority: P0, then P1, then P2, then P3. Use the ATAM risk format for P0/P1.

### 5. Recommendations

List small, testable, ordered actions. Include expected validation for each action.

### 6. Evidence

Include:

- Documentation files read.
- Source areas inspected.
- Top structural metrics gathered, such as largest files, fan-in, fan-out, or cycles.
- Commands executed with results.
- Commands not run and why.
- Environmental limits or audit limits.

### 7. Do not

- Do not propose a full rewrite without evidence.
- Do not judge only by file size, framework choice, or personal taste.
- Do not confuse the absence of a framework with poor architecture.
- Do not ignore stack and project constraints.
- Do not hide failed commands or skipped checks.
- Do not claim confidence higher than the evidence supports.
