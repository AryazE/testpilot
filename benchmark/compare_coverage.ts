// This script takes two coverage directories and reports the coverage as a percentage.
import fs from "fs";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

if (require.main === module) {
  (async () => {
    const parser = yargs(hideBin(process.argv))
      .strict()
      .options({
        dir1: {
          type: "string",
          demandOption: true,
          description: "directory with results",
        },
        dir2: {
          type: "string",
          demandOption: true,
          description: "directory with results",
        },
      });
    const { dir1, dir2 } = await parser.argv;
    const totalLines = new Set<string>();
    // walk through the first coverage directory
    const coverage1 = new Set<string>();
    const coverageDir1 = dir1 + "/coverageData";
    for (const testDirectory of fs.readdirSync(coverageDir1)) {
      for (const coverageFile of fs.readdirSync(`${coverageDir1}/${testDirectory}`)) {
        const content = JSON.parse(fs.readFileSync(`${coverageDir1}/${testDirectory}/${coverageFile}`, "utf8"));
        for (const sourceFile of Object.keys(content)) {
          // console.log(sourceFile);  
          for (const stmt of Object.keys(content[sourceFile].s)) {
            totalLines.add(`${sourceFile}:${stmt}`);
            if (content[sourceFile].s[stmt] > 0) {
              coverage1.add(`${sourceFile}:${stmt}`);
            }
          }
          // console.log(coverage1.size);
          // console.log(totalLines.size);
        }
      }
    }
    // walk through the second coverage directory
    const coverage2 = new Set<string>();
    const coverageDir2 = dir2 + "/coverageData";
    for (const testDirectory of fs.readdirSync(coverageDir2)) {
      for (const coverageFile of fs.readdirSync(`${coverageDir2}/${testDirectory}`)) {
        const content = JSON.parse(fs.readFileSync(`${coverageDir2}/${testDirectory}/${coverageFile}`, "utf8"));
        for (const sourceFile of Object.keys(content)) {
          // console.log(sourceFile);
          for (const stmt of Object.keys(content[sourceFile].s)) {
            totalLines.add(`${sourceFile}:${stmt}`);
            if (content[sourceFile].s[stmt] > 0) {
              coverage2.add(`${sourceFile}:${stmt}`);
            }
          }
          // console.log(coverage2.size);
          // console.log(totalLines.size);
        }
      }
    }
    // compute the coverage
    const coverage1Size = coverage1.size;
    const coverage2Size = coverage2.size;
    const totalLinesSize = totalLines.size;
    const cov1Name = dir1.split('/').pop();
    const cov2Name = dir2.split('/').pop();
    console.log(`Coverage 1 (${cov1Name}): ${coverage1Size} statements`);
    console.log(`Coverage 2 (${cov2Name}): ${coverage2Size} statements`);
    console.log(`Total lines: ${totalLinesSize} lines`);
    console.log(`Coverage 1 (${cov1Name}): ${((coverage1Size / totalLinesSize) * 100).toFixed(2)}%`);
    console.log(`Coverage 2 (${cov2Name}): ${((coverage2Size / totalLinesSize) * 100).toFixed(2)}%`);
  })();
}