export class CodeEmbedding {
  static task = "feature-extraction";
  static model = "jinaai/jina-embeddings-v2-base-code";
  static instance: Promise<any>;
  static async getInstance() {
    if (this.instance == null) {
      let { pipeline } = await import("@xenova/transformers");
      this.instance ??= pipeline(this.task, this.model);
    }
    return this.instance;
  }
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
