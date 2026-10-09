import { describe, expect, it } from "vitest";
import { LlmApiError, LlmConfigError, transcribe } from "../src";
import { noSleep, scriptedFetch, type Call } from "./helpers";

const KEY = "gsk-test-not-a-real-key";
const audio = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 1, 2, 3]); // "OggS…"

describe("transcribe (Groq)", () => {
  it("posts a multipart request with file, model and language", async () => {
    const calls: Call[] = [];
    const res = await transcribe(audio, {
      filename: "voice.ogg",
      mimeType: "audio/ogg",
      language: "es",
      apiKey: KEY,
      provider: "groq",
      fetchFn: scriptedFetch([{ body: { text: " pasá 200 dólares a pesos " } }], calls),
    });
    expect(res.text).toBe("pasá 200 dólares a pesos");

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(headers).not.toHaveProperty("content-type"); // fetch adds the multipart boundary

    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("language")).toBe("es");
    expect(form.get("response_format")).toBe("json");
    const file = form.get("file") as File;
    expect(file.name).toBe("voice.ogg");
    expect(file.type).toBe("audio/ogg");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(audio);
  });

  it("omits language when not given", async () => {
    const calls: Call[] = [];
    await transcribe(audio, { filename: "v.ogg", mimeType: "audio/ogg", apiKey: KEY, provider: "groq", fetchFn: scriptedFetch([{ body: { text: "hi" } }], calls) });
    expect((calls[0]!.init.body as FormData).has("language")).toBe(false);
  });

  it("retries a 429 and surfaces a 401 as a typed error", async () => {
    const calls: Call[] = [];
    const ok = await transcribe(audio, {
      filename: "v.ogg",
      mimeType: "audio/ogg",
      apiKey: KEY,
      provider: "groq",
      retry: noSleep,
      fetchFn: scriptedFetch([{ status: 429, body: "rate" }, { body: { text: "oi" } }], calls),
    });
    expect(ok.text).toBe("oi");
    expect(calls).toHaveLength(2);

    const err = await transcribe(audio, {
      filename: "v.ogg",
      mimeType: "audio/ogg",
      apiKey: KEY,
      provider: "groq",
      retry: noSleep,
      fetchFn: scriptedFetch([{ status: 401, body: { error: { message: "Invalid API Key" } } }]),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmApiError);
    expect(err.status).toBe(401);
    expect(String(err.message)).not.toContain(KEY);
  });

  it("validates config and input before calling out", async () => {
    const fetchFn = scriptedFetch([{ body: { text: "x" } }]);
    await expect(transcribe(audio, { filename: "v.ogg", mimeType: "audio/ogg", apiKey: KEY, provider: "openai", fetchFn })).rejects.toBeInstanceOf(LlmConfigError);
    await expect(transcribe(audio, { filename: "v.ogg", mimeType: "audio/ogg", apiKey: "", provider: "groq", fetchFn })).rejects.toThrow(/STT_API_KEY/);
    await expect(transcribe(new Uint8Array(), { filename: "v.ogg", mimeType: "audio/ogg", apiKey: KEY, provider: "groq", fetchFn })).rejects.toThrow(/empty/);
  });
});
