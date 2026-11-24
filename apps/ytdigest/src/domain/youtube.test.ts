import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createYouTubeClient, parseChannelInput } from "./youtube.js";

const ID = "UCBJycsmduvYEL83R_U4JriQ";

describe("parseChannelInput", () => {
  it("looks up handles, ids and channel URLs directly", () => {
    assert.deepEqual(parseChannelInput("  @mkbhd "), { kind: "handle", value: "@mkbhd" });
    assert.deepEqual(parseChannelInput(ID), { kind: "id", value: ID });
    for (const url of [
      "https://www.youtube.com/@mkbhd",
      "youtube.com/@mkbhd/videos",
      "https://m.youtube.com/@mkbhd?si=abc",
    ]) {
      assert.deepEqual(parseChannelInput(url), { kind: "handle", value: "@mkbhd" }, url);
    }
    assert.deepEqual(parseChannelInput(`https://www.youtube.com/channel/${ID}/featured`), { kind: "id", value: ID });
    assert.deepEqual(parseChannelInput("https://youtube.com/user/marquesbrownlee"), {
      kind: "username",
      value: "marquesbrownlee",
    });
  });

  it("searches for anything else, including names that start like an id", () => {
    assert.deepEqual(parseChannelInput("Marques Brownlee"), { kind: "query", value: "Marques Brownlee" });
    assert.deepEqual(parseChannelInput("UCLA basketball"), { kind: "query", value: "UCLA basketball" });
    assert.deepEqual(parseChannelInput("https://www.youtube.com/c/mkbhd"), { kind: "query", value: "mkbhd" });
    assert.deepEqual(parseChannelInput("https://www.youtube.com/watch?v=abc"), {
      kind: "query",
      value: "https://www.youtube.com/watch?v=abc",
    });
    assert.deepEqual(parseChannelInput("https://www.youtube.com/c/%E0%A4"), { kind: "query", value: "%E0%A4" });
  });
});

describe("createYouTubeClient", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** Answers each endpoint from `responses` and records the calls. */
  function stubFetch(responses: Record<string, unknown>) {
    const calls: URL[] = [];
    globalThis.fetch = (async (input: string | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      const endpoint = url.pathname.split("/").pop()!;
      return new Response(JSON.stringify(responses[endpoint] ?? {}), { status: 200 });
    }) as typeof fetch;
    return calls;
  }

  const channel = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
    id,
    snippet: { title, customUrl: `@${title.toLowerCase()}`, thumbnails: { default: { url: `https://img/${id}` } } },
    statistics: { subscriberCount: "1500", videoCount: "42" },
    ...extra,
  });

  it("searches by name, keeps the search's order and caches the answer", async () => {
    const calls = stubFetch({
      search: { items: [{ id: { channelId: "UCb" } }, { id: { channelId: "UCa" } }, { id: {} }] },
      channels: {
        items: [
          channel("UCa", "Alpha", { statistics: { subscriberCount: "9", hiddenSubscriberCount: true } }),
          channel("UCb", "Beta", { snippet: { title: "Beta", customUrl: "betaold" } }),
        ],
      },
    });
    const yt = createYouTubeClient("key");

    const results = await yt.searchChannels("  some Name ");
    assert.deepEqual(
      results.map((r) => [r.youtubeChannelId, r.title, r.handle, r.subscriberCount, r.videoCount]),
      [
        ["UCb", "Beta", "@betaold", 1500, 42],
        ["UCa", "Alpha", "@alpha", null, null],
      ],
    );
    assert.equal(results[1].thumbnailUrl, "https://img/UCa");
    assert.deepEqual(
      calls.map((u) => [u.pathname.split("/").pop(), u.searchParams.get("q") ?? u.searchParams.get("id")]),
      [
        ["search", "some Name"],
        ["channels", "UCb,UCa"],
      ],
    );
    assert.equal(calls[0].searchParams.get("type"), "channel");

    await yt.searchChannels("SOME NAME");
    assert.equal(calls.length, 2, "the same search again costs no quota");
  });

  it("looks a handle up without searching, and finds nothing for an unknown one", async () => {
    const calls = stubFetch({ channels: { items: [channel(ID, "Mkbhd")] } });
    const yt = createYouTubeClient("key");
    assert.deepEqual(
      (await yt.searchChannels("https://www.youtube.com/@mkbhd")).map((r) => r.youtubeChannelId),
      [ID],
    );
    assert.deepEqual(
      calls.map((u) => [u.pathname.split("/").pop(), u.searchParams.get("forHandle")]),
      [["channels", "@mkbhd"]],
    );

    // channels.list leaves `items` out when nothing matches.
    stubFetch({ channels: { kind: "youtube#channelListResponse" } });
    assert.deepEqual(await yt.searchChannels("@nobody-here"), []);
    assert.equal(await yt.resolveChannel("@nobody-here"), null);
  });

  it("resolves a channel URL to its uploads playlist", async () => {
    stubFetch({
      channels: {
        items: [
          {
            id: ID,
            snippet: { title: "Mkbhd" },
            contentDetails: { relatedPlaylists: { uploads: "UUBJycsmduvYEL83R_U4JriQ" } },
          },
        ],
      },
    });
    assert.deepEqual(await createYouTubeClient("key").resolveChannel(`youtube.com/channel/${ID}`), {
      youtubeChannelId: ID,
      title: "Mkbhd",
      thumbnailUrl: null,
      uploadsPlaylistId: "UUBJycsmduvYEL83R_U4JriQ",
    });
  });
});
