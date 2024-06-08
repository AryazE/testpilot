import fs from "fs";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

if (require.main === module) {
  (async () => {
    const parser = yargs(hideBin(process.argv))
      .strict()
      .options({
        reportDir: {
          type: "string",
          demandOption: true,
          description:
            "root directory",
        },
      });
    const { reportDir } = await parser.argv;
    // loop throug subdirectories
    const subdirs = fs.readdirSync(reportDir);
    let total = 0;
    let count = 0;
    for (const subdir of subdirs) {
      const queries = JSON.parse(
        fs.readFileSync(`${reportDir}/${subdir}/codexQueryTimes.json`, "utf8")
      );
      for (const query of queries) {
        total += query[1];
        count++;
      }
    }
    console.log(total / count);
})().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
