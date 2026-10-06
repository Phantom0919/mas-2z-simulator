/**
 * 剧情线引擎：把 data/story.js 里的章节，翻译成引擎认得的"事件"，并决定什么时候触发。
 *
 * 和随机事件的区别：
 *   1. 剧情章节是**排队强制触发**的——引擎里 rollEvent() 会先看 flags.scriptedEvent，
 *      命中就直接放行、不掷骰子，所以剧情绝不会被随机事件挤掉；
 *   2. 剧情事件带 story: true，随机事件池会把它过滤掉，保证顺序不乱；
 *   3. 每触发一章就记进 game.story，界面上的"故事线"面板直接读它。
 *
 * 章节之间的间隔由 STORY_GAP 控制：连着几周都弹剧情会腻，所以隔两周才放一章。
 */

import { STORY_ARCS, STORY_ARC_MAP } from './data/story.js';

/** 两章剧情之间至少隔几周（turn）。 */
export const STORY_GAP = 2;

export { STORY_ARCS, STORY_ARC_MAP };

/** 剧情章节 → 事件 id。 */
export function storyEventId(arcId, chapterId) {
  return `story_${arcId}_${chapterId}`;
}

/** 章节在整条线里的序号（第几章，从 1 开始）。 */
function chapterIndex(arc, chapterId) {
  return arc.chapters.findIndex((chapter) => chapter.id === chapterId) + 1;
}

/**
 * 把一个章节包成引擎事件。
 * @param {object} arc data/story.js 里的一条线
 * @param {object} chapter
 */
export function chapterToEvent(arc, chapter) {
  const effect = { ...(chapter.effect ?? {}) };
  if (chapter.flags) effect.flags = { ...(effect.flags ?? {}), ...chapter.flags };

  const event = {
    id: storyEventId(arc.id, chapter.id),
    name: chapter.title,
    icon: arc.icon ?? '📖',
    kind: chapter.choices?.length ? 'choice' : 'auto',
    weight: 0,
    once: true,
    /** 标记：这是剧情，不进随机池 */
    story: true,
    storyArc: arc.id,
    storyArcTitle: arc.title,
    storyChapter: chapter.id,
    storyPerson: arc.person ?? null,
    storyIndex: chapterIndex(arc, chapter.id),
    storyTotal: arc.chapters.length,
    text: (game) => resolveChapterText(chapter.text, game),
    effect,
    cond: () => false, // 双保险：就算被丢进随机池也不会被抽到
  };

  if (chapter.choices?.length) {
    event.choices = chapter.choices.map((choice) => ({
      id: choice.id,
      label: (game) => resolveChapterText(choice.label, game),
      hint: choice.hint ? (game) => resolveChapterText(choice.hint, game) : null,
      outcome: (game) => resolveChapterText(choice.outcome, game),
      effect: choice.effect,
    }));
  }
  return event;
}

function resolveChapterText(value, game) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'function') {
    try {
      return String(value(game, game?.cast?.map ?? {}));
    } catch {
      return '';
    }
  }
  return String(value);
}

/** 全部剧情事件（引擎会把它们并进 EVENT_MAP）。 */
export function storyEvents() {
  const list = [];
  for (const arc of STORY_ARCS) {
    for (const chapter of arc.chapters) list.push(chapterToEvent(arc, chapter));
  }
  return list;
}

const ALL_STORY_EVENTS = storyEvents();
const STORY_EVENT_MAP = Object.fromEntries(ALL_STORY_EVENTS.map((event) => [event.id, event]));

export const STORY_EVENT_IDS = ALL_STORY_EVENTS.map((event) => event.id);

/** 一条线里已经过了几章。 */
function doneCount(game, arcId) {
  return (game.story ?? []).filter((entry) => entry.arc === arcId).length;
}

/** 这条线的下一章（还没触发过的第一章）。 */
function nextChapter(game, arc) {
  const done = doneCount(game, arc.id);
  return arc.chapters[done] ?? null;
}

function meetsRequirement(game, chapter) {
  const req = chapter.requires;
  if (!req) return true;
  if (req.npc && (game.npc?.[req.npc] ?? 0) < (req.min ?? 0)) return false;
  if (req.flag && !game.flags?.[req.flag]) return false;
  if (typeof req.when === 'function' && !req.when(game)) return false;
  return true;
}

/**
 * 看看有没有该演的剧情，有就排队等下一次行动触发。
 *
 * 每周行动结束时调用一次即可；没排上就返回 null，什么也不做。
 * @returns {{ arcId: string, chapterId: string, eventId: string } | null}
 */
export function advanceStory(game) {
  if (!game || game.status !== 'playing') return null;
  // 已经排了一个（不管是剧情还是别的强制事件），别插队
  if (game.flags?.scriptedEvent) return null;

  const last = Number(game.flags?.storyLastTurn);
  if (Number.isFinite(last) && game.turn - last < STORY_GAP) return null;

  // 收集所有"到点了"的下一章，优先演最该演的那一章（拖得最久的）。
  // 这样七条线会轮流推进，不会出现前两条线把名额占完、后面的线一章都不演。
  const candidates = [];
  STORY_ARCS.forEach((arc, arcIndex) => {
    const chapter = nextChapter(game, arc);
    if (!chapter) return;
    if ((chapter.week ?? 0) > game.turn) return;
    if (!meetsRequirement(game, chapter)) return;
    const eventId = storyEventId(arc.id, chapter.id);
    if (!STORY_EVENT_MAP[eventId]) return;
    candidates.push({ arc, chapter, eventId, arcIndex, overdue: game.turn - (chapter.week ?? 0) });
  });
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.overdue - a.overdue || a.arcIndex - b.arcIndex);
  const chosen = candidates[0];
  game.flags.scriptedEvent = chosen.eventId;
  game.flags.storyLastTurn = game.turn;
  return { arcId: chosen.arc.id, chapterId: chosen.chapter.id, eventId: chosen.eventId };
}

/**
 * 剧情真的弹出来时调用，把这一章记进存档（界面上的"故事线"读这个）。
 * @param {object} game
 * @param {object} event 引擎事件（带 storyArc / storyChapter）
 * @param {string} text 已经解析过名字的正文
 * @param {string} at 时间标签，例如"高一上学期 第 3 周"
 */
export function recordStory(game, event, text, at) {
  if (!event?.story) return null;
  game.story ??= [];
  if (game.story.some((entry) => entry.arc === event.storyArc && entry.id === event.storyChapter)) return null;
  const entry = {
    arc: event.storyArc,
    arcTitle: event.storyArcTitle,
    arcIcon: event.icon ?? '📖',
    arcPerson: event.storyPerson ?? null,
    personName: game.cast?.map?.[event.storyPerson]?.name ?? null,
    id: event.storyChapter,
    index: event.storyIndex ?? 1,
    total: event.storyTotal ?? 1,
    title: event.name,
    text,
    turn: game.turn,
    week: game.week,
    at: at ?? '',
  };
  game.story.push(entry);
  return entry;
}

/* ------------------------------------------------------------ 界面数据 */

/** 故事线的进度摘要（放进 viewState，很轻）。 */
export function storyProgress(game) {
  const story = game?.story ?? [];
  const arcs = STORY_ARCS.map((arc) => ({
    id: arc.id,
    title: arc.title,
    icon: arc.icon ?? '📖',
    person: arc.person ?? null,
    personName: game?.cast?.map?.[arc.person]?.name ?? null,
    intro: arc.intro ?? '',
    total: arc.chapters.length,
    done: story.filter((entry) => entry.arc === arc.id).length,
  }));
  return {
    arcs,
    total: arcs.reduce((sum, arc) => sum + arc.total, 0),
    done: arcs.reduce((sum, arc) => sum + arc.done, 0),
  };
}

/**
 * 故事线的完整数据（给"故事线"弹层用）：
 * 每条线列出所有章节，已解锁的带正文，未解锁的只给标题和线索。
 */
export function storyCatalog(game) {
  const story = game?.story ?? [];
  const byKey = Object.fromEntries(story.map((entry) => [`${entry.arc}:${entry.id}`, entry]));
  return STORY_ARCS.map((arc) => ({
    id: arc.id,
    title: arc.title,
    icon: arc.icon ?? '📖',
    intro: arc.intro ?? '',
    person: arc.person ?? null,
    personName: game?.cast?.map?.[arc.person]?.name ?? null,
    total: arc.chapters.length,
    done: arc.chapters.filter((chapter) => byKey[`${arc.id}:${chapter.id}`]).length,
    chapters: arc.chapters.map((chapter) => {
      const record = byKey[`${arc.id}:${chapter.id}`];
      return {
        id: chapter.id,
        title: chapter.title,
        week: chapter.week ?? 0,
        unlocked: Boolean(record),
        at: record?.at ?? null,
        text: record?.text ?? null,
      };
    }),
  }));
}
