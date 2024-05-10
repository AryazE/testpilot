import { expect } from "chai";
import { CodeEmbedding, cosineSimilarity } from "../src/embedding";

describe("Embedding", () => {
  it("should embed similar functions similarly", async () => {
    const embedding = await CodeEmbedding.getInstance();
    const embeddings = await Promise.all([
      embedding("foo.bar(x, y)", { pooling: "mean", normalize: true }),
      embedding("foo.bar(x, y)", { pooling: "mean", normalize: true }),
    ]);
    expect(embeddings[0]).to.deep.equal(embeddings[1]);
  });

  it("should embed different functions differently", async () => {
    const embedding = await CodeEmbedding.getInstance();
    const embeddings = await Promise.all([
      embedding("foo.bar.baz()", { pooling: "mean", normalize: true }),
      embedding("test.check()", { pooling: "mean", normalize: true }),
    ]);
    expect(embeddings[0]).to.not.deep.equal(embeddings[1]);
  });

  it("should embed similar functions more similar than different functions", async () => {
    const embedding = await CodeEmbedding.getInstance();
    const embeddings = await Promise.all([
      embedding("foo.bar(x, y)", { pooling: "mean", normalize: true }),
      embedding("foo.bar(x, y)", { pooling: "mean", normalize: true }),
      embedding("foo.bar.baz()", { pooling: "mean", normalize: true }),
      embedding("test.check()", { pooling: "mean", normalize: true }),
    ]);
    const sim1 = cosineSimilarity(embeddings[0].data, embeddings[1].data);
    const sim2 = cosineSimilarity(embeddings[2].data, embeddings[3].data);
    const sim3 = cosineSimilarity(embeddings[0].data, embeddings[2].data);
    const sim4 = cosineSimilarity(embeddings[1].data, embeddings[3].data);
    expect(sim1).to.be.greaterThan(sim2);
    expect(sim3).to.be.greaterThan(sim4);
  });
});
