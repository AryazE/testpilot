import path from "path";
import { CompletionSet, ICompletionModel } from "./completionModel";
import { readFileSync } from "fs";
import { PostOptions } from "./codex";

export class MockCompletionModel implements ICompletionModel {
  private completionMap: Map<string, CompletionSet> = new Map();
  private totalTokens = 0;

  constructor(private strictResponses: boolean, private readonly tokenLimit: number = 4096) {}

  static fromFile(file: string, strictResponses: boolean, tokenLimit: number = 4096) {
    const data = JSON.parse(readFileSync(file, "utf8"));
    console.log("Loading completions from file");
    const model = new MockCompletionModel(strictResponses, tokenLimit);
    for (const { file: promptFile, temperature, completions, usedTokens } of data.prompts) {
      const prompt = readFileSync(
        path.join(path.dirname(file), "prompts", promptFile),
        "utf8"
      );
      model.addCompletions(prompt, temperature, completions, usedTokens);
    }
    return model;
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
    postOptions: PostOptions = {}
  ): Promise<CompletionSet> {
    const { completions, usedTokens } = this.completionMap.get(this.key(prompt, postOptions.temperature || 0.0)) || { completions: undefined, usedTokens: 0 };
    if (!completions) {
      const err = `Prompt not found at temperature ${postOptions.temperature}: ${prompt}`;
      if (this.strictResponses) {
        throw new Error(err);
      } else {
        console.warn(err);
      }
    }
    this.totalTokens += usedTokens;
    return {
      completions: new Set(completions),
      usedTokens
    };
  }

  public usedTokens(): number {
    return this.totalTokens;
  }
}
