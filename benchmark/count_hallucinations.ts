import fs from "fs";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

type PromptReport = {
  id: number;
  file: string;
  tests: string[];
  provenance: {
    originalPrompt: number;
    test: number;
    refiner: string;
  }[];
};

type TestReport = {
  testName: string;
  promptIds: number[];
  status: string;
  err: {
    stack?: string;
    message?: string;
  };
};

type Hallucination = {
  test: string;
  prompts: number[];
  error: string;
};

const hallucinationFixed = (startingTest: string, testsMap: Map<string, TestReport>, promptsMap: Map<number, PromptReport>, nextPrompts: Map<number, number[]>) => {
  const checkedTests = new Set<string>();
  const q: string[] = [startingTest];
  while (q.length > 0) {
    const test = q.pop()!;
    if (checkedTests.has(test)) {
      continue;
    }
    checkedTests.add(test);
    const testReport = testsMap.get(test);
    if (testReport?.status === "PASSED") {
      return true;
    }
    for (const promptId of testReport?.promptIds ?? []) {
      const prompt = promptsMap.get(promptId);
      if (!prompt) {
        continue;
      }
      for (const nextPrompt of nextPrompts.get(prompt.id) ?? []) {
        const nextPromptReport = promptsMap.get(nextPrompt);
        if (!nextPromptReport) {
          continue;
        }
        for (const test of nextPromptReport.tests) {
          if (!checkedTests.has(test)) {
            q.push(test);
          }
        }
      }
    }
  }
  return false;
};

if (require.main === module) {
  (async () => {
    const parser = yargs(hideBin(process.argv))
      .strict()
      .options({
        reportDir: {
          type: "string",
          demandOption: true,
          description:
            "directory where output files ('report.json', 'prompts.json') are placed",
        },
      });
    const { reportDir } = await parser.argv;
    const tests: TestReport[] = JSON.parse(
      fs.readFileSync(`${reportDir}/report.json`, "utf8")
    ).tests;
    const testsMap = new Map<string, TestReport>();
    for (const test of tests) {
      testsMap.set(test.testName, test);
    }
    const prompts: PromptReport[] = JSON.parse(
      fs.readFileSync(`${reportDir}/prompts.json`, "utf8")
    ).prompts;
    const promptsMap = new Map<number, PromptReport>();
    const nextPrompts = new Map<number, number[]>();
    for (const prompt of prompts) {
      promptsMap.set(prompt.id, prompt);
      for (const provenance of prompt.provenance) {
        if (!nextPrompts.has(provenance.originalPrompt)) {
          nextPrompts.set(provenance.originalPrompt, []);
        }
        nextPrompts.get(provenance.originalPrompt)!.push(prompt.id);
      }
    }
    const fixedHallucinations: Hallucination[] = [];
    const unfixedHallucinations: Hallucination[] = [];
    for (const test of tests) {
      if (test.status === "FAILED" && (test.err.message?.includes("of undefined") || (test.err.stack?.includes("is not a function")))) {
        const fixed = hallucinationFixed(test.testName, testsMap, promptsMap, nextPrompts);
        if (!fixed) {
          unfixedHallucinations.push({
            test: test.testName,
            prompts: test.promptIds,
            error: test.err.message ?? test.err.stack ?? "unknown",
          });
        } else {
          fixedHallucinations.push({
            test: test.testName,
            prompts: test.promptIds,
            error: test.err.message ?? test.err.stack ?? "unknown",
          });
        }
      }
    }
    const hallucinations = {
      stats: {
        fixed: fixedHallucinations.length,
        unfixed: unfixedHallucinations.length,
      },
      fixed: fixedHallucinations,
      unfixed: unfixedHallucinations,
    };
    fs.writeFileSync(
      `${reportDir}/hallucinations.json`,
      JSON.stringify(hallucinations, null, 2)
    );
    console.log(`Fixed: ${fixedHallucinations.length}`);
    console.log(`Unfixed: ${unfixedHallucinations.length}`);
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
