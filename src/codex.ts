import axios from "axios";
import fs from "fs";
import { performance } from "perf_hooks";
import { CompletionSet, ICompletionModel } from "./completionModel";
import { trimCompletion } from "./syntax";

const defaultPostOptions = {
  model: "gpt-3.5-turbo-0125", // model to use
  max_tokens: 100, // maximum number of tokens to return
  temperature: 0, // sampling temperature; higher values increase diversity
  n: 5, // number of completions to return
  top_p: 1, // no need to change this
};
export type PostOptions = Partial<typeof defaultPostOptions>;

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Please set the ${name} environment variable.`);
    process.exit(1);
  }
  return value;
}

export class Codex implements ICompletionModel {
  private readonly apiEndpoint: string;
  private readonly authHeaders: string;

  constructor(
    private readonly isStarCoder: boolean,
    private readonly instanceOptions: PostOptions = {}
  ) {
    this.apiEndpoint = this.isStarCoder
      ? getEnv("STARCODER_API_ENDPOINT")
      : getEnv("TESTPILOT_LLM_API_ENDPOINT");
    this.authHeaders = this.isStarCoder
      ? "{}"
      : getEnv("TESTPILOT_LLM_AUTH_HEADERS");
    console.log(
      `Using ${this.isStarCoder ? "StarCoder" : "GPT"} API at ${
        this.apiEndpoint
      }`
    );
  }

  /**
   * Query Codex for completions with a given prompt.
   *
   * @param prompt The prompt to use for the completion.
   * @param requestPostOptions The options to use for the request.
   * @returns A promise that resolves to a set of completions.
   */
  public async query(
    prompt: string,
    requestPostOptions: PostOptions = {}
  ): Promise<CompletionSet> {
    const headers = {
      "Content-Type": "application/json",
      ...JSON.parse(this.authHeaders),
    };
    const options = {
      ...defaultPostOptions,
      // options provided to constructor override default options
      ...this.instanceOptions,
      // options provided to this function override default and instance options
      ...requestPostOptions,
    };

    performance.mark("codex-query-start");

    const postOptions = this.isStarCoder
      ? {
          inputs: prompt,
          parameters: {
            max_new_tokens: options.max_tokens,
            temperature: options.temperature || 0.01, // StarCoder doesn't allow 0
            n: options.n,
          },
        }
      : {
          messages: [
            {
              role: "system",
              content:
                "You are a professional JavaScript developer. Your task is to test the provided library and cover the most code. Complete the test such that it passes.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          ...options,
        };

    await new Promise((resolve) => setTimeout(resolve, 200));
    const res = await axios.post(this.apiEndpoint, postOptions, { headers });

    performance.measure(
      `codex-query:${JSON.stringify({
        ...options,
        promptLength: prompt.length,
      })}`,
      "codex-query-start"
    );
    if (res.status !== 200) {
      throw new Error(
        `Request failed with status ${res.status} and message ${res.statusText}`
      );
    }
    if (!res.data) {
      throw new Error("Response data is empty");
    }
    const json = res.data;
    if (json.error) {
      throw new Error(json.error);
    }
    let numContentFiltered = 0;
    const completions = new Set<string>();
    if (this.isStarCoder) {
      completions.add(json.generated_text);
    } else {
      for (const choice of json.choices || [{ text: "" }]) {
        if (choice.finish_reason === "content_filter") {
          numContentFiltered++;
        }
        completions.add(choice.message.content);
      }
    }
    if (numContentFiltered > 0) {
      console.warn(
        `${numContentFiltered} completions were truncated due to content filtering.`
      );
    }
    return {
      completions,
      usedTokens: json.usage.total_tokens,
    };
  }

  /**
   * Get completions from Codex and postprocess them as needed; print a warning if it did not produce any
   *
   * @param prompt the prompt to use
   */
  public async completions(
    prompt: string,
    temperature: number
  ): Promise<CompletionSet> {
    for (let i = 0; i < 3; i++) {
      try {
        let result = new Set<string>();
        const { completions, usedTokens } = await this.query(prompt, { temperature });
        for (const completion of completions) {
          let completionLines = completion.split("\n");
          let codePart = "";
          let started = false;
          for (let i = 0; i < completionLines.length; i++) {
            if (completionLines[i].startsWith("```")) {
              if (started) break;
              started = true;
              continue;
            }
            if (started && completionLines[i].trim().length > 0)
              codePart += completionLines[i] + "\n";
          }
          if (!started) codePart = completion;
          codePart = removeSharedPart(prompt, codePart);
          result.add(trimCompletion(codePart));
        }
        return {
          completions: result,
          usedTokens,
        };
      } catch (err: any) {
        if (err.message.includes("Request failed with status code 429")) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          console.warn("Rate limited, retrying...");
          continue;
        }
        console.warn(`Failed to get completions: ${err.message}`);
        return {
          completions: new Set<string>(),
          usedTokens: 0,
        };
      }
    }
    return {
      completions: new Set<string>(),
      usedTokens: 0,
    };
  }
}

function removeSharedPart(prompt: string, completion: string): string {
  let result = "";
  let completionLines = completion.split("\n");
  let promptLines = prompt.split("\n");
  for (let i = 0; i < completionLines.length; i++) {
    if (
      !promptLines.includes(completionLines[i]) &&
      !completionLines[i].trim().startsWith("it(") &&
      !completionLines[i].trim().startsWith("describe(")
    ) {
      result += completionLines[i] + "\n";
    }
  }
  return result;
}

if (require.main === module) {
  (async () => {
    const codex = new Codex(false);
    const prompt = fs.readFileSync(0, "utf8");
    const responses = await codex.query(prompt, { n: 1 });
    console.log([...responses.completions][0]);
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
