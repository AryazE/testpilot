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
  status: string;
  err: {
    stack?: string;
    message?: string;
  };
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
    for (const prompt of prompts) {
      promptsMap.set(prompt.id, prompt);
    }
    const promptSuccess = new Map<number, string>();
    for (const prompt of prompts) {
      const testResults = prompt.tests.map((test) => {
        if (testsMap.get(test)!.status === "PASSED") return "PASSED";
        else if (
          testsMap.get(test)!.status === "FAILED" &&
          testsMap.get(test)!.err.stack?.startsWith("AssertionError")
        )
          return "AssertionFailed";
        else return "FAILED";
      });
      if (testResults.includes("PASSED")) {
        promptSuccess.set(prompt.id, "PASSED");
      } else if (testResults.includes("AssertionFailed")) {
        promptSuccess.set(prompt.id, "AssertionFailed");
      } else {
        promptSuccess.set(prompt.id, "FAILED");
      }
    }
    let improvements: {
      summary: {
        refiner: string;
        successful: number;
        improvedError: number;
        tried: number;
      }[];
      instances: {
        refiner: string;
        successInstances: {
          before: number[];
          after: number;
        }[];
        improvedInstances: {
          before: number[];
          after: number;
        }[];
      }[];
    } = {
      summary: [],
      instances: [],
    };
    for (const prompt of prompts) {
      for (const refiner of new Set(prompt.provenance.map((p) => p.refiner))) {
        if (
          improvements.summary.find((i) => i.refiner === refiner) === undefined
        ) {
          improvements.summary.push({
            refiner,
            successful: 0,
            improvedError: 0,
            tried: 0,
          });
          improvements.instances.push({
            refiner,
            successInstances: [],
            improvedInstances: [],
          });
        }
        const existingSummary = improvements.summary.find(
          (i) => i.refiner === refiner
        );
        const existingInstance = improvements.instances.find(
          (i) => i.refiner === refiner
        );
        if (promptSuccess.get(prompt.id) === "PASSED") {
          if (
            prompt.provenance.every(
              (pr) => promptSuccess.get(pr.originalPrompt) !== "PASSED"
            )
          ) {
            existingSummary!.successful++;
            existingInstance!.successInstances.push({
              before: prompt.provenance.map((pr) => pr.originalPrompt),
              after: prompt.id,
            });
          }
        } else if (promptSuccess.get(prompt.id) === "AssertionFailed") {
          if (
            prompt.provenance.every(
              (pr) => promptSuccess.get(pr.originalPrompt) === "FAILED"
            )
          ) {
            existingSummary!.improvedError++;
            existingInstance!.improvedInstances.push({
              before: prompt.provenance.map((pr) => pr.originalPrompt),
              after: prompt.id,
            });
          }
        }
        existingSummary!.tried++;
      }
    }
    fs.writeFileSync(
      `${reportDir}/improvements.json`,
      JSON.stringify(improvements, null, 2)
    );
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
