import { PostOptions } from "./codex";

export type CompletionSet = {
  completions: Set<string>;
  usedTokens: number;
};
/**
 * An abstract representation of a model such as Codex that can provide
 * completions for a prompt.
 */
export interface ICompletionModel {
  /**
   * Get a set of completions for the given prompt with the given sampling temperature.
   */
  completions(prompt: string, postOptions: PostOptions): Promise<CompletionSet>;

  /**
   * Get the number of token used.
   */
  usedTokens(): number;
}
