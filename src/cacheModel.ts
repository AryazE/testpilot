import path from "path";
import { CompletionSet, ICompletionModel } from "./completionModel";
import { Codex, PostOptions } from "./codex";
import { readFileSync } from "fs";

export class CachedCompletionModel implements ICompletionModel {
  private completionMap: Map<string, CompletionSet> = new Map();
  private usedTokens = 0;
  private realModel: Codex;
  private numOfCompletions: number;

  constructor(private strictResponses: boolean, file: string, isStarCoder: boolean, instanceOptions: PostOptions = {}) {
    const data = JSON.parse(readFileSync(file, "utf8"));
    this.numOfCompletions = instanceOptions.n || 1;
    console.log("Loading completions from file");
    for (const { file: promptFile, temperature, completions, usedTokens } of data.prompts) {
      const prompt = readFileSync(
        path.join(path.dirname(file), "prompts", promptFile),
        "utf8"
      );
      this.addCompletions(prompt, temperature, completions, usedTokens);
    }
    this.realModel = new Codex(isStarCoder, instanceOptions);
  }

  private key(prompt: string, temperature: number) {
    return JSON.stringify([prompt, temperature]);
  }

  public addCompletions(
    prompt: string,
    temperature: number,
    completions: string[],
    usedTokens: number
  ) {
    this.completionMap.set(this.key(prompt, temperature), { completions: new Set(completions), usedTokens });
  }

  public async completions(
    prompt: string,
    temperature: number
  ): Promise<CompletionSet> {
    const { completions, usedTokens } = this.completionMap.get(this.key(prompt, temperature)) || { completions: undefined, usedTokens: 0 };
    if (!completions || completions.size < this.numOfCompletions) {
      const err = `Prompt not found at temperature ${temperature}: ${prompt}`;
      if (this.strictResponses) {
        throw new Error(err);
      } else {
        // console.warn(err);
        return await this.realModel.completions(prompt, temperature);
      }
    }
    return {
      completions,
      usedTokens,
    };
  }
}
