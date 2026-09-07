/* The provider client reads through candidate field names rather than assuming
   one payload shape, so these tests feed it the shapes it might actually meet.
   A provider renaming a field should degrade one value, not blank the app. */
import * as P from '../api/_provider.js';

let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : (fail++, console.log(`  FAIL: ${n} ${d}`)); };

console.log('--- provider client ---');

check('accepts canonical url', P.validTikTokUrl('https://www.tiktok.com/@a/video/1'));
check('accepts short url', P.validTikTokUrl('https://vm.tiktok.com/ZMabc/'));
check('rejects lookalike domain', !P.validTikTokUrl('https://tiktok.com.evil.io/@a/video/1'));
check('rejects http', !P.validTikTokUrl('http://www.tiktok.com/@a/video/1'));

const snake = { aweme_detail: { aweme_id: '77', desc: 'stop doing this #tips',
  author: { unique_id: 'ty', follower_count: 9000, verified: true },
  music: { title: 'original sound', original: true },
  statistics: { play_count: 1000, digg_count: 100, comment_count: 10, share_count: 50, collect_count: 80 },
  video: { duration: 22, cover: 'c.jpg' }, hashtags: [{ name: 'Tips' }] } };
const camel = { id: '88', description: 'hello there #x', author: { uniqueId: 'bo' },
  authorStats: { followerCount: 500 },
  stats: { playCount: 2000, diggCount: 40, commentCount: 4, shareCount: 8, collectCount: 12 },
  duration: 19000, challenges: [{ title: 'X' }] };

for (const [name, raw] of [['snake_case', snake], ['camelCase', camel]]) {
  const v = P.normalizeVideo(raw, { url: 'u' });
  check(`${name}: caption read`, v.caption.length > 0);
  check(`${name}: id read`, !!v.id);
  check(`${name}: author read`, !!v.author);
  check(`${name}: plays read`, v.stats.plays > 0);
  check(`${name}: hashtags read`, v.hashtags.length === 1, JSON.stringify(v.hashtags));
  check(`${name}: hashtags lowercased`, v.hashtags.every(h => h === h.toLowerCase()));
  check(`${name}: rates computed`, !!v.rates && v.rates.share > 0);
}

check('seconds left alone', P.normalizeVideo(snake).duration === 22);
check('milliseconds converted', P.normalizeVideo(camel).duration === 19, String(P.normalizeVideo(camel).duration));
check('follower count read from author', P.normalizeVideo(snake).followerCount === 9000);
check('original sound flag read', P.normalizeVideo(snake).soundOriginal === true);

const bare = P.normalizeVideo({ id: '99', desc: 'just words' });
check('bare payload does not throw', bare.caption === 'just words');
check('bare payload has zeroed stats', bare.stats.plays === 0);
check('bare payload has null rates', bare.rates === null);
check('empty payload survives', P.normalizeVideo({}).stats.plays === 0);
check('null payload survives', P.normalizeVideo(null).caption === '');

check('hashtags fall back to caption parsing',
  P.normalizeVideo({ id: '1', desc: 'a #alpha and #beta' }).hashtags.join(',') === 'alpha,beta');

const cm = P.normalizeComments({ comments: [
  { text: 'link?', digg_count: 5 }, { content: 'how much', likes: 2 },
  { comment: 'x' }, { text: '' }, { desc: 'does it work with android' }] });
check('comments read across field names', cm.length === 3, JSON.stringify(cm));
check('empty comments filtered', !cm.some(c => c.text === ''));
check('comment likes read', cm[0].likes === 5);
check('comment array without envelope', P.normalizeComments([{ text: 'hey' }]).length === 1);
check('null comments survive', P.normalizeComments(null).length === 0);

const t = P.normalizeTranscript({ transcript: '  hello world  ', subtitles: [{ source: 'ASR' }, { source: 'CREATOR' }] });
check('transcript trimmed', t.text === 'hello world');
check('tracks counted', t.tracks === 2);
check('creator captions detected', t.creatorCaptioned === true);
check('segmented transcript joined',
  P.normalizeTranscript({ text: [{ text: 'one' }, { text: 'two' }] }).text === 'one two');
check('null transcript survives', P.normalizeTranscript(null).text === '');

check('video list from aweme_list', P.normalizeVideoList({ aweme_list: [{ aweme_id: '1', desc: 'a', statistics: { play_count: 5 } }] }).length === 1);
check('video list from videos', P.normalizeVideoList({ videos: [{ id: '2', desc: 'b' }] }).length === 1);
check('video list unwraps aweme_info', P.normalizeVideoList({ data: [{ aweme_info: { aweme_id: '3', desc: 'c' } }] })[0].caption === 'c');
check('bare array list', P.normalizeVideoList([{ id: '4', desc: 'd' }]).length === 1);
check('null list survives', P.normalizeVideoList(null).length === 0);

/* Regression: a real payload has a `video` field holding media metadata.
   Unwrapping into it silently blanked caption, id and every stat. */
const withMedia = { id: '5', description: 'real caption #tag', video: { duration: 30, cover: 'c.jpg' },
  stats: { play_count: 4000, digg_count: 9, comment_count: 2, share_count: 3, collect_count: 4 },
  author: { unique_id: 'zz' } };
const wm = P.normalizeVideo(withMedia);
check('media `video` field does not swallow the record', wm.caption === 'real caption #tag', JSON.stringify(wm.caption));
check('id survives a media field', wm.id === '5');
check('stats survive a media field', wm.stats.plays === 4000, String(wm.stats.plays));
check('duration still read from media field', wm.duration === 30, String(wm.duration));
check('stats.snake_case read', P.normalizeVideo({ id: '1', desc: 'x', stats: { play_count: 12 } }).stats.plays === 12);

const listWithMedia = P.normalizeVideoList({ videos: Array.from({ length: 3 }, (_, i) => ({
  id: String(i), description: `v${i} #tag`, video: { duration: 30 },
  stats: { play_count: (i + 1) * 1000 }, author: { unique_id: 'u' + i } })) });
check('list items keep captions', listWithMedia.every(v => v.caption.length > 0));
check('list items keep plays', listWithMedia.every(v => v.stats.plays > 0));
check('list items keep ids', listWithMedia.every(v => v.id !== null));

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
