import dedent from "dedent";
import { APIFunction, ApiElementDescriptor, sanitizePackageName } from "./exploreAPI";
import { TestOutcome, TestStatus } from "./report";
import { closeBrackets, commentOut, trimAndCombineDocComment } from "./syntax";
import { CodeEmbedding, cosineSimilarity } from "./embedding";

const MaxAdditionalSignatures = 3;
const MaxRetrievalIterations = 3;

/**
 * A strategy object for refining a prompt based on the outcome of a test
 * generated from it.
 */
export interface IPromptRefiner {
  /** A human-readable name for identifying this refiner. */
  get name(): string;

  /**
   * Refine the `original` prompt based on the `outcome` of a test generated
   * from it and the given `body`.
   */
  refine(original: Prompt, body: string, outcome: TestOutcome): Prompt[];
}

/**
 * Options for controlling prompt generation.
 */
type PromptOptions = {
  /** Whether to include usage snippets in the prompt. */
  includeSnippets: boolean;
  /** Whether to include the function's doc comment in the prompt. */
  includeDocComment: boolean;
  /** Whether to include the function's body in the prompt. */
  includeFunctionBody: boolean;
  /** The number of iterations with RAG. */
  ragTries: number;
};

export function defaultPromptOptions(): PromptOptions {
  return {
    includeSnippets: false,
    includeDocComment: false,
    includeFunctionBody: false,
    ragTries: 0,
  };
}

/**
 * Structured representation of a prompt we send to the model.
 *
 * In general, our prompts look like this:
 *
 * ```js
 * let mocha = require('mocha');            // -+
 * let assert = require('assert');          //  | Imports
 * let pkg = require('pkg');                // -+
 *
 * // usage #1                              // -+
 * ...                                      //  |
 * // usage #2                              //  | Usage snippets
 * ...                                      // -+
 *
 * // this does...                          // -+
 * // @param foo                            //  |
 * // @returns bar                          //  | Doc comment
 * ...                                      // -+
 *
 * // fn(args)                              //    Signature of the function we're testing
 * // function fn(args) {                   // -+
 * //     ...                               //  | Function body (optional)
 * // }                                     // -+
 * // API Reference:                        // -+
 * // fn1(args)                             //  |
 * // fn2(args)                             //  | Additional signatures
 * // ...                                   //  |
 * // fnN(args)                             // -+
 *
 * describe('test pkg', function() {        //    Test suite header
 *   it('test fn', function(done) {         //    Test case header
 * ```
 *
 * The structured representation keeps track of these parts and provides methods
 * to assemble them into a textual prompt and complete them into a test case.
 */
export class Prompt {
  private readonly imports: string;
  private readonly signature: string;
  private readonly relevantSignatures: string;
  private readonly docComment: string;
  private readonly functionBody: string;
  private readonly suiteHeader: string;
  protected readonly testHeader: string;
  public readonly provenance: PromptProvenance[] = [];

  constructor(
    public readonly fun: APIFunction,
    public readonly usageSnippets: string[],
    public readonly options: PromptOptions,
    public readonly additionalSignatures: string[] = []
  ) {
    const sanitizedPackageName = sanitizePackageName(fun.packageName);
    this.imports = dedent`
            let mocha = require('mocha');
            let assert = require('assert');
            let ${sanitizedPackageName} = require('${fun.packageName}');\n`;

    this.signature = commentOut(fun.signature);

    if (options.includeFunctionBody) {
      this.functionBody = commentOut(fun.descriptor.implementation);
    } else {
      this.functionBody = "";
    }

    this.suiteHeader = `describe('test ${sanitizedPackageName}', function() {\n`;
    this.testHeader = `    it('test ${fun.accessPath}', function(done) {\n`;

    if (options.includeDocComment) {
      this.docComment = trimAndCombineDocComment(
        fun.descriptor.docComment ?? ""
      );
    } else {
      this.docComment = "";
    }

    if (options.ragTries > 0 && options.ragTries <= MaxRetrievalIterations && this.additionalSignatures.length > 0) {
      this.relevantSignatures = "// API Reference:\n" + this.additionalSignatures
        .map(commentOut)
        .slice(
          0,
          Math.min(this.additionalSignatures.length, MaxAdditionalSignatures)
        )
        .join("");
    } else {
      this.relevantSignatures = "";
    }
  }

  /**
   * Assemble the usage snippets into a single string.
   */
  private assembleUsageSnippets(): string {
    if (!this.options.includeSnippets) {
      return "";
    } else {
      return this.usageSnippets
        .map((snippet, index) => {
          const lines = snippet.split("\n");
          const commentedLines = lines.map((line) => `// ${line}\n`);
          return `// usage #${index + 1}\n` + commentedLines.join("");
        })
        .join("");
    }
  }

  /**
   * Assemble a prompt to send to the model from the structured
   * representation.
   */
  public assemble(): string {
    return (
      this.imports +
      this.assembleUsageSnippets() +
      truncateIfLong(this.docComment) +
      this.signature +
      truncateIfLong(this.functionBody) +
      this.relevantSignatures +
      this.suiteHeader +
      this.testHeader
    );
  }

  /**
   * Given a test body suggested by the model, assemble a complete,
   * syntactically correct test.
   */
  public completeTest(
    body: string,
    stubOutHeaders: boolean = true
  ): string | undefined {
    let fixed = closeBrackets(
      this.imports +
        (stubOutHeaders
          ? // stub out suite header and test header so we don't double-count identical tests
            "describe('test suite', function() {\n" +
            "    it('test case', function(done) {\n"
          : this.suiteHeader + this.testHeader) +
        // add the body, making sure the first line is indented correctly
        body.replace(/^(?=\S)/, " ".repeat(8)) +
        "\n"
    );
    // beautify closing brackets
    return fixed?.source.replace(/\}\)\}\)$/, "    })\n})");
  }

  public withProvenance(...provenanceInfos: PromptProvenance[]): Prompt {
    this.provenance.push(...provenanceInfos);
    if (
      this.provenance.length > 0 &&
      this.provenance[this.provenance.length - 1].refiner.startsWith(
        "APIReferenceIncluder"
      )
    ) {
      this.provenance[this.provenance.length - 1].refiner =
        this.provenance[this.provenance.length - 1].refiner +
        " " +
        this.options.ragTries;
    }
    return this;
  }

  public functionHasDocComment(): boolean {
    return this.fun.descriptor.docComment !== undefined;
  }
}

/**
 * A record of how a prompt was generated, including information about which
 * `originalPrompt` it was generated from, information about the test that gave
 * rise to the prompt refinement, and the name of the refiner.
 */
export type PromptProvenance = {
  originalPrompt: Prompt;
  testId: number;
  refiner: string;
};

/**
 * A prompt refiner that adds usage snippets to the prompt.
 */
export class SnippetIncluder implements IPromptRefiner {
  public get name(): string {
    return "SnippetIncluder";
  }

  public refine(
    original: Prompt,
    completion: string,
    outcome: TestOutcome
  ): Prompt[] {
    if (
      !original.options.includeSnippets &&
      original.usageSnippets.length > 0
    ) {
      return [
        new Prompt(original.fun, original.usageSnippets, {
          ...original.options,
          includeSnippets: true,
        }),
      ];
    }
    return [];
  }
}

/**
 * A prompt refiner that adds a function's doc comments to the prompt.
 */
export class DocCommentIncluder implements IPromptRefiner {
  public get name(): string {
    return "DocCommentIncluder";
  }

  public refine(
    original: Prompt,
    completion: string,
    outcome: TestOutcome
  ): Prompt[] {
    if (
      !original.options.includeDocComment &&
      original.functionHasDocComment()
    ) {
      return [
        new Prompt(original.fun, original.usageSnippets, {
          ...original.options,
          includeDocComment: true,
        }),
      ];
    }
    return [];
  }
}

export class RetryPromptFailedTest extends Prompt {
  constructor(
    prev: Prompt,
    private body: string,
    private readonly err: string,
    private readonly optionalText: string = ""
  ) {
    super(prev.fun, prev.usageSnippets, prev.options);
  }

  public assemble() {
    const rawFailingTest = super.assemble() + this.body + "\n";
    const completedFailingTest = closeBrackets(rawFailingTest);
    let failingTest;
    if (completedFailingTest) {
      failingTest = completedFailingTest.source.replace(
        /\}\)\}\)$/,
        "    })\n"
      );
    } else {
      failingTest = rawFailingTest + "    })\n";
    }

    let errorMessage = "";
    if (this.err.includes("\n")) {
      errorMessage =
        truncateIfLong(this.err)
          .split("\n")
          .map((line) => `    // ${line}`)
          .join("\n") + "\n";
    } else {
      errorMessage = `    // ${this.err}\n`;
    }
    let extraText = "";
    if (this.optionalText.includes("\n")) {
      extraText =
        this.optionalText
          .split("\n")
          .slice(0, MaxAdditionalSignatures)
          .map(commentOut)
          .join("\n") + "\n";
    }
    return (
      failingTest +
      "    // the test above fails with the following error:\n" +
      errorMessage +
      extraText +
      "    // fixed test:\n" +
      this.testHeader
    );
  }
}

/**
 * A prompt refiner that, for a failed test, adds the error message to the
 * prompt and tries again.
 */
export class RetryWithError implements IPromptRefiner {
  public get name(): string {
    return "RetryWithError";
  }

  public refine(
    original: Prompt,
    completion: string,
    outcome: TestOutcome
  ): Prompt[] {
    if (
      !(original instanceof RetryPromptFailedTest) &&
      outcome.status === TestStatus.FAILED
    ) {
      return [
        new RetryPromptFailedTest(original, completion, outcome.err.message),
      ];
    }
    return [];
  }
}

/**
 * A prompt refiner that includes the body of the function in the prompt.
 */
export class FunctionBodyIncluder implements IPromptRefiner {
  public get name(): string {
    return "FunctionBodyIncluder";
  }

  public refine(
    original: Prompt,
    completion: string,
    outcome: TestOutcome
  ): Prompt[] {
    if (
      !original.options.includeFunctionBody &&
      original.fun.descriptor.implementation !== ""
    ) {
      return [
        new Prompt(original.fun, original.usageSnippets, {
          ...original.options,
          includeFunctionBody: true,
        }),
      ];
    }
    return [];
  }
}

/**
 * A prompt refiner that, for a failed test, adds the relevant function
 * signatures to the prompt.
 */
export class APIReferenceIncluder implements IPromptRefiner {
  public get name(): string {
    return "APIReferenceIncluder";
  }

  public refine(
    original: Prompt,
    body: string,
    outcome: TestOutcome
  ): Prompt[] {
    return [];
  }

  public async refineAsync(
    original: Prompt,
    completion: string,
    outcome: TestOutcome,
    fullAPI: { accessPath: string; descriptor: ApiElementDescriptor, packageName: string }[],
    apiEmbeddings: Array<{ data: Float32Array }>
  ): Promise<Prompt[]> {
    if (
      original.options.ragTries < MaxRetrievalIterations &&
      outcome.status === TestStatus.FAILED &&
      (outcome.err.message.includes("is not a function") ||
        outcome.err.message.includes("of undefined"))
    ) {
      const embedding = await CodeEmbedding.getInstance();
      // const functionCalls = new Set(completion.match(/([\w\.]+)\(/g));
      // const attributeAccesses = new Set(completion.match(/(\w+(?:\.\w+)+)(?!\()/g));
      const functionCalls = new Set(outcome.err.message.match(/([\w\.]+)\(/g));
      const attributeAccesses = new Set(outcome.err.message.match(/(\w+(?:\.\w+)+)(?!\()/g));
      if (!functionCalls && !attributeAccesses) {
        return [];
      }
      const allEmbeddings = await Promise.all(
        [...functionCalls, ...attributeAccesses].map((f) =>
          embedding(f, { pooling: "mean", normalize: true })
        )
      );
      let topKSimilars: Map<string, number> = new Map();
      for (const singleEmbedding of allEmbeddings) {
        const similarities = apiEmbeddings.map((emb) =>
          cosineSimilarity(emb.data, singleEmbedding.data)
        );
        const frozenSimilarities = similarities.slice();
        similarities.sort().reverse();
        for (const sim of similarities.slice(0, 15)) {
          const apiElement = fullAPI[frozenSimilarities.indexOf(sim)];
          let sig = apiElement.accessPath;
          if (apiElement.descriptor.type === "function")
            sig += apiElement.descriptor.signature;
          if (!topKSimilars.has(sig)) topKSimilars.set(sig, sim);
        }
      }
      return [
        new Prompt(
          original.fun,
          original.usageSnippets,
          {
            ...original.options,
            ragTries: original.options.ragTries + 1,
          },
          Array.from(topKSimilars)
            .sort((a, b) => b[1] - a[1])
            .map(([sig, _]) => sig)
        ),
      ];
    }
    return [];
  }
}

/**
 * A prompt refiner that, for a failed test caused by hallucinations, 
 * adds the error message and relevant API reference to the prompt and tries again.
 */
export class RetryWithAPIReference implements IPromptRefiner {
  public get name(): string {
    return "RetryWithAPIReference";
  }

  public refine(
    original: Prompt,
    completion: string,
    outcome: TestOutcome
  ): Prompt[] {
    return [];
  }

  public async refineAsync(
    original: Prompt,
    completion: string,
    outcome: TestOutcome,
    fullAPI: { accessPath: string; descriptor: ApiElementDescriptor, packageName: string }[],
    apiEmbeddings: Array<{ data: Float32Array }>
  ): Promise<Prompt[]> {
    if (
      original.options.ragTries < MaxRetrievalIterations &&
      outcome.status === TestStatus.FAILED &&
      (outcome.err.message.includes("is not a function") ||
        outcome.err.message.includes("of undefined"))
    ) {
      const embedding = await CodeEmbedding.getInstance();
      const functionCalls = new Set(completion.match(/([\w\.]+)\(/g));
      const attributeAccesses = new Set(completion.match(/(\w+(?:\.\w+)+)(?!\()/g));
      if (!functionCalls && !attributeAccesses) {
        return [];
      }
      const allEmbeddings = await Promise.all(
        [...functionCalls, ...attributeAccesses].map((f) =>
          embedding(f, { pooling: "mean", normalize: true })
        )
      );
      let topKSimilars: Map<string, number> = new Map();
      for (const singleEmbedding of allEmbeddings) {
        const similarities = apiEmbeddings.map((emb) =>
          cosineSimilarity(emb.data, singleEmbedding.data)
        );
        const frozenSimilarities = similarities.slice();
        similarities.sort().reverse();
        for (const sim of similarities.slice(0, 15)) {
          const apiElement = fullAPI[frozenSimilarities.indexOf(sim)];
          let sig = apiElement.accessPath;
          if (apiElement.descriptor.type === "function")
            sig += apiElement.descriptor.signature;
          if (!topKSimilars.has(sig)) topKSimilars.set(sig, sim);
        }
      }
      const apiRef = Array.from(topKSimilars).sort((a, b) => b[1] - a[1]).map(([sig, _]) => sig).join("\n");
      return [
        new RetryPromptFailedTest(original, completion, outcome.err.message, "The following are available:\n" + apiRef),
      ];
    }
    return [];
  }
}

function truncateIfLong(body: string): string {
  const lines = body.split("\n");
  if (lines.length > 30) {
    return lines.slice(0, 30).join("\n") + "\n";
  } else {
    return body;
  }
}
