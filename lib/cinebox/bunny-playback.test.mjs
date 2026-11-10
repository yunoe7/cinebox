import test from "node:test";
import assert from "node:assert/strict";
import {
  bunnyPlaybackProgress,
  bunnyTimeUpdate,
  isBunnyEmbedUrl,
  withBunnyResume,
} from "./bunny-playback.mjs";

test("reconnaît uniquement les URLs d'embed Bunny Stream", () => {
  assert.equal(isBunnyEmbedUrl("https://iframe.mediadelivery.net/embed/123/video-guid"), true);
  assert.equal(isBunnyEmbedUrl("https://player.mediadelivery.net/embed/123/video-guid"), true);
  assert.equal(isBunnyEmbedUrl("https://iframe.mediadelivery.net/embed/123/video-guid/"), true);
  assert.equal(isBunnyEmbedUrl("https://iframe.mediadelivery.net/embed/123/video-guid?t=30"), true);
  assert.equal(isBunnyEmbedUrl("https://example.com/embed/123/video-guid"), false);
  assert.equal(isBunnyEmbedUrl("https://iframe.mediadelivery.net/play/123/video-guid"), false);
  assert.equal(isBunnyEmbedUrl("blob:https://cinebox.local/video"), false);
  assert.equal(isBunnyEmbedUrl(null), false);
});

test("ajoute le paramètre de reprise Bunny sans casser l'URL existante", () => {
  assert.equal(
    withBunnyResume("https://iframe.mediadelivery.net/embed/123/video-guid", 125.8),
    "https://iframe.mediadelivery.net/embed/123/video-guid?t=125",
  );
  assert.equal(
    withBunnyResume("https://iframe.mediadelivery.net/embed/123/video-guid?autoplay=true", 42),
    "https://iframe.mediadelivery.net/embed/123/video-guid?autoplay=true&t=42",
  );
  assert.equal(withBunnyResume("https://iframe.mediadelivery.net/embed/123/video-guid", 3), "https://iframe.mediadelivery.net/embed/123/video-guid");
  assert.equal(withBunnyResume("https://iframe.mediadelivery.net/embed/123/video-guid", 0), "https://iframe.mediadelivery.net/embed/123/video-guid");
  assert.equal(withBunnyResume("https://example.com/video", 42), "https://example.com/video");
});

test("normalise les événements timeupdate objets et JSON", () => {
  assert.deepEqual(bunnyTimeUpdate({ seconds: 10, duration: 40 }), { seconds: 10, duration: 40 });
  assert.deepEqual(bunnyTimeUpdate('{"seconds":12,"duration":48}'), { seconds: 12, duration: 48 });
  assert.deepEqual(bunnyTimeUpdate({ seconds: 10 }), { seconds: 10, duration: 0 });
  assert.equal(bunnyTimeUpdate("not-json"), null);
  assert.equal(bunnyTimeUpdate({ seconds: -1, duration: 40 }), null);
  assert.equal(bunnyTimeUpdate(null), null);
});

test("calcule une progression plafonnée à 99 % avant la fin", () => {
  assert.deepEqual(bunnyPlaybackProgress(10, 40), { second: 10, progress: 25 });
  assert.deepEqual(bunnyPlaybackProgress(39.9, 40), { second: 39, progress: 99 });
  assert.deepEqual(bunnyPlaybackProgress(40, 40), { second: 40, progress: 99 });
  assert.deepEqual(bunnyPlaybackProgress(10, 0), { second: 10, progress: 0 });
  assert.deepEqual(bunnyPlaybackProgress(10.9, 0), { second: 10, progress: 0 });
  assert.equal(bunnyPlaybackProgress(-1, 40), null);
  assert.equal(bunnyPlaybackProgress(Number.NaN, 40), null);
});
