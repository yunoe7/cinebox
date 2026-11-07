import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  createBlobUrlLease,
  createProvisionalBlobUrlBatch,
  retainBlobUrl,
  syncBlobUrlOwner,
} from "./blob-url-manager.mjs";

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
const created = [];
const revoked = [];
URL.createObjectURL = (blob) => {
  const url = originalCreate.call(URL, blob);
  created.push(url);
  return url;
};
URL.revokeObjectURL = (url) => {
  revoked.push(url);
  originalRevoke.call(URL, url);
};

after(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

async function flushRevocations() {
  await new Promise((resolve) => queueMicrotask(resolve));
}

test("01 — crée une URL Blob réelle et libère un lot provisoire une seule fois", async () => {
  const batch = createProvisionalBlobUrlBatch();
  const url = batch.create(new Blob(["synthetic poster"], { type: "image/png" }));
  assert.equal(created.at(-1), url);
  assert.match(url, /^blob:/);
  batch.release();
  batch.release();
  await flushRevocations();
  assert.deepEqual(revoked.filter((entry) => entry === url), [url]);
});

test("02 — le transfert rend l'URL durable et le nettoyage du lot ne la révoque pas", async () => {
  const batch = createProvisionalBlobUrlBatch();
  const url = batch.create(new Blob(["synthetic video"], { type: "video/webm" }));
  assert.equal(batch.transferTo("library:test"), true);
  batch.release();
  syncBlobUrlOwner("library:test", [url]);
  await flushRevocations();
  assert.equal(revoked.includes(url), false);
  syncBlobUrlOwner("library:test", []);
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === url).length, 1);
});

test("03 — les propriétaires partagés protègent l'URL jusqu'au dernier retrait", async () => {
  const batch = createProvisionalBlobUrlBatch();
  const url = batch.create(new Blob(["shared image"]));
  batch.transferTo("library:shared");
  syncBlobUrlOwner("selected:shared", [url]);
  syncBlobUrlOwner("library:shared", []);
  await flushRevocations();
  assert.equal(revoked.includes(url), false);
  syncBlobUrlOwner("selected:shared", []);
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === url).length, 1);
});

test("04 — un bail temporaire protège une URL après le retrait du propriétaire durable", async () => {
  const batch = createProvisionalBlobUrlBatch();
  const url = batch.create(new Blob(["player source"]));
  batch.transferTo("library:player");
  const lease = retainBlobUrl(url);
  syncBlobUrlOwner("player-view", [url]);
  syncBlobUrlOwner("library:player", []);
  await flushRevocations();
  assert.equal(revoked.includes(url), false);
  syncBlobUrlOwner("player-view", []);
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === url).length, 0);
  lease.release();
  lease.release();
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === url).length, 1);
});

test("05 — la synchronisation ajoute les nouvelles références avant de libérer les anciennes", async () => {
  const first = createProvisionalBlobUrlBatch();
  const oldUrl = first.create(new Blob(["old"]));
  first.transferTo("library:replace");
  syncBlobUrlOwner("library:replace", [oldUrl]);

  const next = createProvisionalBlobUrlBatch();
  const newUrl = next.create(new Blob(["new"]));
  next.transferTo("library:replace");
  syncBlobUrlOwner("library:replace", [newUrl]);
  assert.equal(revoked.includes(oldUrl), false);
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === oldUrl).length, 1);
  assert.equal(revoked.includes(newUrl), false);
  syncBlobUrlOwner("library:replace", []);
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === newUrl).length, 1);
});

test("06 — la réacquisition avant le point de libération annule la révocation", async () => {
  const batch = createProvisionalBlobUrlBatch();
  const url = batch.create(new Blob(["strict effect replay"]));
  batch.transferTo("library:strict");
  syncBlobUrlOwner("library:strict", []);
  syncBlobUrlOwner("library:strict", [url]);
  await flushRevocations();
  assert.equal(revoked.includes(url), false);
  syncBlobUrlOwner("library:strict", []);
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === url).length, 1);
});

test("07 — une erreur pendant la création libère les URL déjà créées dans le lot", async () => {
  let calls = 0;
  const previousCreate = URL.createObjectURL;
  URL.createObjectURL = (blob) => {
    calls += 1;
    if (calls === 2) throw new Error("synthetic create failure");
    return previousCreate.call(URL, blob);
  };
  const batch = createProvisionalBlobUrlBatch();
  const firstUrl = batch.create(new Blob(["first"]));
  assert.throws(() => batch.create(new Blob(["second"])), /synthetic create failure/);
  URL.createObjectURL = previousCreate;
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === firstUrl).length, 1);
});

test("08 — la restauration réussie transfère plusieurs URL partagées à la bibliothèque", async () => {
  const batch = createProvisionalBlobUrlBatch();
  const poster = batch.create(new Blob(["restored poster"]));
  const episode = batch.create(new Blob(["restored episode"]));
  batch.transferTo("library:restore-success");
  syncBlobUrlOwner("library:restore-success", [poster, episode]);
  syncBlobUrlOwner("detail:restore-success", [poster]);
  await flushRevocations();
  assert.equal(revoked.includes(poster), false);
  assert.equal(revoked.includes(episode), false);
  syncBlobUrlOwner("library:restore-success", []);
  await flushRevocations();
  assert.equal(revoked.includes(poster), false);
  assert.equal(revoked.filter((entry) => entry === episode).length, 1);
  syncBlobUrlOwner("detail:restore-success", []);
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === poster).length, 1);
});

test("09 — une restauration partielle en erreur libère toutes ses URL provisoires", async () => {
  const batch = createProvisionalBlobUrlBatch();
  const urls = [batch.create(new Blob(["poster"])), batch.create(new Blob(["video"])), batch.create(new Blob(["thumbnail"]))];
  batch.release();
  await flushRevocations();
  for (const url of urls) assert.equal(revoked.filter((entry) => entry === url).length, 1);
});

test("10 — une annulation de restauration avant publication libère le lot", async () => {
  const batch = createProvisionalBlobUrlBatch();
  const urls = [batch.create(new Blob(["first read"])), batch.create(new Blob(["second read"]))];
  batch.release();
  batch.transferTo("library:cancelled-restore");
  await flushRevocations();
  for (const url of urls) assert.equal(revoked.filter((entry) => entry === url).length, 1);
});

test("11 — remplacer une affiche libère l'ancienne après le retrait de sa dernière vue", async () => {
  const oldBatch = createProvisionalBlobUrlBatch();
  const oldPoster = oldBatch.create(new Blob(["old poster"]));
  oldBatch.transferTo("library:poster-replace");
  syncBlobUrlOwner("library:poster-replace", [oldPoster]);
  syncBlobUrlOwner("detail:poster-replace", [oldPoster]);
  const nextBatch = createProvisionalBlobUrlBatch();
  const nextPoster = nextBatch.create(new Blob(["new poster"]));
  nextBatch.transferTo("library:poster-replace");
  syncBlobUrlOwner("library:poster-replace", [nextPoster]);
  await flushRevocations();
  assert.equal(revoked.includes(oldPoster), false);
  assert.equal(revoked.includes(nextPoster), false);
  syncBlobUrlOwner("detail:poster-replace", []);
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === oldPoster).length, 1);
  syncBlobUrlOwner("library:poster-replace", []);
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === nextPoster).length, 1);
});

test("12 — remplacer une vidéo conserve l'ancienne tant que le lecteur l'utilise", async () => {
  const oldBatch = createProvisionalBlobUrlBatch();
  const oldVideo = oldBatch.create(new Blob(["old video"]));
  oldBatch.transferTo("library:video-replace");
  const player = retainBlobUrl(oldVideo);
  const nextBatch = createProvisionalBlobUrlBatch();
  const nextVideo = nextBatch.create(new Blob(["new video"]));
  nextBatch.transferTo("library:video-replace");
  syncBlobUrlOwner("library:video-replace", [nextVideo]);
  await flushRevocations();
  assert.equal(revoked.includes(oldVideo), false);
  player.release();
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === oldVideo).length, 1);
  syncBlobUrlOwner("library:video-replace", []);
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === nextVideo).length, 1);
});

test("13 — remplacer la vidéo d'un épisode ne révoque pas sa miniature", async () => {
  const oldVideoBatch = createProvisionalBlobUrlBatch();
  const oldVideo = oldVideoBatch.create(new Blob(["old episode"]));
  const thumbnailBatch = createProvisionalBlobUrlBatch();
  const thumbnail = thumbnailBatch.create(new Blob(["episode thumbnail"]));
  oldVideoBatch.transferTo("library:episode-video");
  thumbnailBatch.transferTo("library:episode-video");
  syncBlobUrlOwner("library:episode-video", [oldVideo, thumbnail]);
  const nextBatch = createProvisionalBlobUrlBatch();
  const nextVideo = nextBatch.create(new Blob(["new episode"]));
  nextBatch.transferTo("library:episode-video");
  syncBlobUrlOwner("library:episode-video", [nextVideo, thumbnail]);
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === oldVideo).length, 1);
  assert.equal(revoked.includes(thumbnail), false);
  assert.equal(revoked.includes(nextVideo), false);
  syncBlobUrlOwner("library:episode-video", []);
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === thumbnail).length, 1);
  assert.equal(revoked.filter((entry) => entry === nextVideo).length, 1);
});

test("14 — remplacer une miniature d'épisode conserve la vidéo", async () => {
  const current = createProvisionalBlobUrlBatch();
  const video = current.create(new Blob(["episode video"]));
  const oldThumbnail = current.create(new Blob(["old thumbnail"]));
  current.transferTo("library:episode-thumbnail");
  syncBlobUrlOwner("library:episode-thumbnail", [video, oldThumbnail]);
  const replacement = createProvisionalBlobUrlBatch();
  const newThumbnail = replacement.create(new Blob(["new thumbnail"]));
  replacement.transferTo("library:episode-thumbnail");
  syncBlobUrlOwner("library:episode-thumbnail", [video, newThumbnail]);
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === oldThumbnail).length, 1);
  assert.equal(revoked.includes(video), false);
  assert.equal(revoked.includes(newThumbnail), false);
  syncBlobUrlOwner("library:episode-thumbnail", []);
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === video).length, 1);
  assert.equal(revoked.filter((entry) => entry === newThumbnail).length, 1);
});

test("15 — supprimer un épisode libère seulement ses deux URL médias", async () => {
  const batch = createProvisionalBlobUrlBatch();
  const keptVideo = batch.create(new Blob(["kept episode"]));
  const removedVideo = batch.create(new Blob(["removed episode"]));
  const removedThumbnail = batch.create(new Blob(["removed thumbnail"]));
  batch.transferTo("library:episode-delete");
  syncBlobUrlOwner("library:episode-delete", [keptVideo, removedVideo, removedThumbnail]);
  syncBlobUrlOwner("library:episode-delete", [keptVideo]);
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === removedVideo).length, 1);
  assert.equal(revoked.filter((entry) => entry === removedThumbnail).length, 1);
  assert.equal(revoked.includes(keptVideo), false);
  syncBlobUrlOwner("library:episode-delete", []);
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === keptVideo).length, 1);
});

test("16 — supprimer un titre attend la fermeture de sa fenêtre de détail", async () => {
  const batch = createProvisionalBlobUrlBatch();
  const poster = batch.create(new Blob(["title poster"]));
  const video = batch.create(new Blob(["title video"]));
  batch.transferTo("library:title-delete");
  syncBlobUrlOwner("library:title-delete", [poster, video]);
  syncBlobUrlOwner("detail:title-delete", [poster, video]);
  syncBlobUrlOwner("library:title-delete", []);
  await flushRevocations();
  assert.equal(revoked.includes(poster), false);
  assert.equal(revoked.includes(video), false);
  syncBlobUrlOwner("detail:title-delete", []);
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === poster).length, 1);
  assert.equal(revoked.filter((entry) => entry === video).length, 1);
});

test("17 — échec de publication libère les URL importées et conserve l'ancien média", async () => {
  const original = createProvisionalBlobUrlBatch();
  const oldUrl = original.create(new Blob(["old published"]));
  original.transferTo("library:publication-failure");
  syncBlobUrlOwner("library:publication-failure", [oldUrl]);
  const staged = createProvisionalBlobUrlBatch();
  const stagedUrl = staged.create(new Blob(["unpublished import"]));
  const published = false;
  if (!published) staged.release();
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === stagedUrl).length, 1);
  assert.equal(revoked.includes(oldUrl), false);
  syncBlobUrlOwner("library:publication-failure", []);
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === oldUrl).length, 1);
});

test("18 — staging partiel libère les nouvelles URL sans retirer les anciennes", async () => {
  const previous = createProvisionalBlobUrlBatch();
  const oldVideo = previous.create(new Blob(["old library media"]));
  previous.transferTo("library:partial-stage");
  syncBlobUrlOwner("library:partial-stage", [oldVideo]);
  const staged = createProvisionalBlobUrlBatch();
  const stagedPoster = staged.create(new Blob(["staged poster"]));
  const stagedEpisode = staged.create(new Blob(["staged episode"]));
  staged.release();
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === stagedPoster).length, 1);
  assert.equal(revoked.filter((entry) => entry === stagedEpisode).length, 1);
  assert.equal(revoked.includes(oldVideo), false);
  syncBlobUrlOwner("library:partial-stage", []);
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === oldVideo).length, 1);
});

test("19 — le lecteur garde un bail pendant le remplacement de sa source", async () => {
  const sourceBatch = createProvisionalBlobUrlBatch();
  const source = sourceBatch.create(new Blob(["playing old source"]));
  sourceBatch.transferTo("library:reader-replacement");
  const reader = retainBlobUrl(source);
  const replacement = createProvisionalBlobUrlBatch();
  const next = replacement.create(new Blob(["next source"]));
  replacement.transferTo("library:reader-replacement");
  syncBlobUrlOwner("library:reader-replacement", [next]);
  await flushRevocations();
  assert.equal(revoked.includes(source), false);
  reader.release();
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === source).length, 1);
  syncBlobUrlOwner("library:reader-replacement", []);
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === next).length, 1);
});

test("20 — plusieurs vues partagent sans compteur de libération prématurée", async () => {
  const batch = createProvisionalBlobUrlBatch();
  const url = batch.create(new Blob(["shared view source"]));
  batch.transferTo("library:many-views");
  const detail = retainBlobUrl(url);
  const player = retainBlobUrl(url);
  const editor = retainBlobUrl(url);
  syncBlobUrlOwner("library:many-views", []);
  detail.release();
  player.release();
  await flushRevocations();
  assert.equal(revoked.includes(url), false);
  editor.release();
  await flushRevocations();
  assert.equal(revoked.filter((entry) => entry === url).length, 1);
});

test("21 — démontage répété libère les baux temporaires même si release est rejoué", async () => {
  const urls = [];
  for (let index = 0; index < 5; index += 1) {
    const lease = createBlobUrlLease(new Blob([`temporary preview ${index}`]));
    urls.push(lease.url);
    lease.release();
    lease.release();
  }
  await flushRevocations();
  for (const url of urls) assert.equal(revoked.filter((entry) => entry === url).length, 1);
});

test("22 — imports et remplacements répétés reviennent à zéro URL active", async () => {
  const urls = [];
  for (let index = 0; index < 6; index += 1) {
    const batch = createProvisionalBlobUrlBatch();
    const url = batch.create(new Blob([`cycle ${index}`]));
    urls.push(url);
    batch.transferTo("library:repeated-imports");
    syncBlobUrlOwner("library:repeated-imports", [url]);
  }
  syncBlobUrlOwner("library:repeated-imports", []);
  await flushRevocations();
  for (const url of urls) assert.equal(revoked.filter((entry) => entry === url).length, 1);
});
