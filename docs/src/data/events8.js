/**
 * 第八批事件：**人情账本**（v3.7）——别人帮了你，几个月后要来讨。
 *
 * 玩法说明见 `src/data/favors.js`（那份表是数值与后果的单一真源，本文件只负责"发生什么"）。
 * 每组两环：
 *   - `favor_offer_*`：随机池里的那一环。某个选项写 `favor: { kind }` → **当场拿到好处**，
 *     同时欠下一笔账（引擎按 favors.js 的表排一条到点必弹的讨债链）。
 *   - `favor_collect_*`：`chainOnly: true` 的讨债环。三个选项分别
 *     `favor: { resolve: 'repay' | 'delay' | 'refuse' }`，数值由 favors.js 结算。
 *
 * 写这一批的约定（和 tools/check-events8.mjs 一一对应）：
 *   1. **欠账只写 `favor` 字段，不写 stats/npc/money 结算**：还多少、拖多重、赖多狠
 *      全部来自 favors.js 的表。offer 里的 stats/knowledge/money 只是"当场的好处"。
 *   2. 每个 offer 事件**恰好一个**选项带 `favor.kind`；其余选项是"婉拒 / 自己扛"，
 *      不欠账，只给轻微的状态或关系变化。
 *   3. 讨债环要能**独立读懂**：不假设玩家记得当初那个选项，先把"谁在讨、讨什么、
 *      从哪来的"说清楚；拖过一次再来的那一环用 `favorDelayedXxx` 换一段更冷的语气。
 *   4. 六组人情的语气要分得开：同桌是安静的小心翼翼，死党是随口的江湖气，
 *      数学老师是成年人的分寸，老对手是绷着的骄傲，爸妈是压着的关心。
 *
 * 校历：12 个 id 都登记在 src/data/calendar.js（collect 是 chainOnly，也照样登记）。
 * 自检：`node tools/check-events8.mjs`。文案里不写死人名，用
 * {deskmate} / {friend} / {math} / {rival} / {parents} 占位符。
 */

export const FAVOR_EVENTS = [
  /* ==================================================================== *
   *  ① 借笔记（同桌）：你把人家记了三年的本子抱回宿舍
   * ==================================================================== */
  {
    id: 'favor_offer_notes',
    name: '借来的笔记',
    icon: '📓',
    kind: 'choice',
    weight: 10,
    text:
      '期中考前一周，{deskmate}把那本包着旧挂历纸的笔记从抽屉里抽出来，往你桌角一搁：“我记了三年的，你拿去看。”' +
      '本子边角磨得发软，翻开一页全是红笔圈的易错点，夹层里还掖着两张食堂饭票。晚自习的灯管在头顶嗡嗡响。',
    choices: [
      {
        id: 'borrow_notes',
        label: '借过来，抄两个通宵',
        hint: '省时间，欠一笔账',
        outcome:
          '你把笔记抱回宿舍，台灯压到枕头边，抄到凌晨一点半。第二天做题，手感顺得不像自己的，' +
          '只是每翻一页都想起还欠着人家什么。',
        effect: {
          stats: { mood: 3, fatigue: 3 },
          knowledge: { weakest: 1.6, count: 2 },
          favor: { kind: 'notes' },
        },
      },
      {
        id: 'glance_at_desk',
        label: '站在他桌边，把重点抄下来',
        hint: '十分钟，不算欠',
        outcome:
          '你在他桌边站了十分钟，把他红笔圈的重点抄进自己的本子。他催了两次“快点，我要去打球”，' +
          '最后没催第三次，靠在椅背上等你抄完。',
        effect: { stats: { mood: 1 }, knowledge: { weakest: 0.8, count: 1 }, npc: { deskmate: 1 } },
      },
      {
        id: 'decline_notes',
        label: '摆手说自己也整理了一份',
        hint: '不欠，慢一点',
        outcome:
          '你摆摆手说“我自己也有一份”。他“哦”了一声，把本子收回去，后脑勺对着你一整个晚自习。' +
          '那晚你整理到十二点，效率低得自己心虚。',
        effect: { stats: { fatigue: 4 }, knowledge: { weakest: 0.6, count: 1 }, npc: { deskmate: -2 } },
      },
    ],
  },
  {
    id: 'favor_collect_notes',
    name: '笔记该还了',
    icon: '📓',
    kind: 'choice',
    chainOnly: true,
    weight: 9,
    text: (game) =>
      game.flags.favorDelayedNotes
        ? '又是晚自习前，{deskmate}把卷子往你桌角一放，这次没绕弯子：“错题清单，你上回说这周就给。' +
          '我不催，可你总得给我个准话。”他手指在桌沿敲了两下，教室后排有人在笑闹，你们这一角很安静。'
        : '晚自习前，{deskmate}把一摞数学卷子挪到你桌角：“笔记你抄完了。我错题堆了一摞，你说过帮我理一份清单。”' +
          '他说得很轻，像在商量，眼睛却没离开你的脸。教室后排有人在拍球。',
    choices: [
      {
        id: 'repay_notes',
        label: '两个晚上给你理出来',
        hint: '熬两晚，账还清',
        outcome:
          '第一晚你理到熄灯，第二天晚上又补了半张纸，才把错题按类型抄成清单。他翻着清单在角上折印，' +
          '折到第三页忽然说“够意思”。回宿舍的路上你腿有点软，心里却空出一块地方。',
        effect: { favor: { resolve: 'repay' } },
      },
      {
        id: 'delay_notes',
        label: '这周真排不开，下周一行吗',
        hint: '账会变重，他记着呢',
        outcome:
          '你说下周一开始。他停了两秒，说“行”，把卷子收回自己桌上，之后一整晚都没再往你这边看。',
        effect: { favor: { resolve: 'delay' } },
      },
      {
        id: 'refuse_notes',
        label: '笔记上又没写欠条',
        hint: '不还了，话会传开',
        outcome:
          '你说“笔记又不是我硬要的”。他盯了你几秒，把卷子叠好塞进抽屉，说“知道了”。' +
          '第二天早读，他给别人讲题讲得很响。',
        effect: { favor: { resolve: 'refuse' } },
      },
    ],
  },

  /* ==================================================================== *
   *  ② 抄作业（死党）：十分钟抄完，走出教学楼的风很凉
   * ==================================================================== */
  {
    id: 'favor_offer_homework',
    name: '抄来的作业',
    icon: '📝',
    kind: 'choice',
    weight: 10,
    text:
      '数学作业还剩最后一页，晚自习下课铃已经响过一遍。{friend}把本子往你桌角一推，压低声音：' +
      '“快点，我等你一起走。”走廊尽头的灯关了一半，值周老师的手电在窗外晃过去。',
    choices: [
      {
        id: 'copy_homework',
        label: '抄最后那道大题',
        hint: '今晚早睡，欠一笔账',
        outcome:
          '你抄得飞快，字迹潦草得自己都认不出。走出教学楼时风比想象中凉，{friend}把他的外套往你肩上一搭，' +
          '说“走快点，宿舍要关门了”。',
        effect: { stats: { fatigue: -4, mood: 2 }, favor: { kind: 'homework' } },
      },
      {
        id: 'ask_extension',
        label: '跟课代表说下午补',
        hint: '不欠，先挨一句',
        outcome:
          '你把本子合上，去跟课代表说下午补。他盯着你看了两秒，说“行，最后一排都等你”。' +
          '{friend}自己先走了，书包带甩得很响。',
        effect: { stats: { mood: -2, discipline: 2 }, npc: { friend: -1 } },
      },
      {
        id: 'finish_myself',
        label: '让他先走，自己写完',
        hint: '不欠，熬一会儿',
        outcome: '你让他先走，自己在教室里写到熄灯。第二天早读差点睡着，但本子上的字是自己的。',
        effect: { stats: { fatigue: 6, discipline: 1 } },
      },
    ],
  },
  {
    id: 'favor_collect_homework',
    name: '值日表上的名字',
    icon: '📝',
    kind: 'choice',
    chainOnly: true,
    weight: 9,
    text: (game) =>
      game.flags.favorDelayedHomework
        ? '早读铃响前，{friend}把拖把往你桌边一靠：“上周说‘再说’，这周还是我。你替我值一次，咱们两清。”' +
          '他声音不高，前排有两个同学回过头来，窗外的雾还没散。'
        : '早读铃响前，{friend}拎着拖把从你桌边过，停了一下：“那天作业的事——我这周早上要练球，' +
          '早读值日你替我一次？就一次。”他眼底下还有没睡醒的红血丝，手里那袋豆浆还冒着气。',
    choices: [
      {
        id: 'repay_homework',
        label: '行，周一早上我来',
        hint: '早起一次，账清',
        outcome:
          '周一你六点二十就到了教室，拎着拖把把走廊拖了两遍。他练完球回来，愣了一下，' +
          '把手里那袋豆浆塞进你桌角，说了句“谢了”。',
        effect: { favor: { resolve: 'repay' } },
      },
      {
        id: 'delay_homework',
        label: '我那时候也困',
        hint: '拖一次，他会记得',
        outcome:
          '你说“下周，下周一定”。他点点头，把拖把扛上肩，说了句“随你”，往走廊尽头走。' +
          '窗户开着，风把地上的水痕吹得发白。',
        effect: { favor: { resolve: 'delay' } },
      },
      {
        id: 'refuse_homework',
        label: '作业都抄了，还计较这个',
        hint: '赖掉，传话的嘴快',
        outcome:
          '你说“我是抄了，可没答应替谁值日”。他笑了一下，那种笑有点难看，说“行，我记住了”，' +
          '扛着拖把走了。',
        effect: { favor: { resolve: 'refuse' } },
      },
    ],
  },

  /* ==================================================================== *
   *  ③ 垫饭钱（死党）：饭卡刷不出来的那声“嘀”
   * ==================================================================== */
  {
    id: 'favor_offer_meal',
    name: '垫上的饭钱',
    icon: '🍜',
    kind: 'choice',
    weight: 9,
    text:
      '中午食堂二楼，你的饭卡在刷卡机上响了一声：“余额不足。”后面排着长队，打饭阿姨的手停在半空。' +
      '{friend}从旁边挤过来，把自己的卡往上一贴，“滴”地刷了：“先吃，回头再说。”',
    choices: [
      {
        id: 'accept_meal',
        label: '让他先垫着',
        hint: '先吃上饭，欠着',
        outcome:
          '你端着餐盘坐下，他又顺手塞给你两瓶水。那顿饭吃得很香，只是每喝一口水，' +
          '你都在心里算那得多少钱。',
        effect: { stats: { mood: 2 }, money: 25, favor: { kind: 'meal' } },
      },
      {
        id: 'pay_next_day',
        label: '说好明天把钱还他',
        hint: '当场清账，不欠人情',
        outcome:
          '你接过卡刷了，第二天早读前把零钱塞进他口袋。他捏着钱愣了一下，说“至于吗”，' +
          '钱还是收了，顺手把你桌上那支笔摆正。',
        effect: { stats: { mood: 1 }, money: -12, npc: { friend: 3 } },
      },
      {
        id: 'skip_meal',
        label: '把餐盘端回去，喝口水算了',
        hint: '不欠，下午会饿',
        outcome:
          '你把餐盘端回去，中午在教室喝了半瓶水。下午第二节课肚子叫得比老师声音还大，' +
          '你多做了一页题，也没觉出饿。',
        effect: { stats: { mood: -3, fatigue: 3 }, knowledge: { all: 0.3 } },
      },
    ],
  },
  {
    id: 'favor_collect_meal',
    name: '那顿没给的饭钱',
    icon: '🍜',
    kind: 'choice',
    chainOnly: true,
    weight: 8,
    text: (game) =>
      game.flags.favorDelayedMeal
        ? '{friend}把饭卡放在你桌角，没坐下：“上次说下一次，这又过了两周。几十块钱我不缺，' +
          '我就是觉得没意思。”他说完看着窗外，操场上有人在跑圈。'
        : '午饭时{friend}在你对面坐下，把饭卡在指间转了半圈：“那天刷的是我的卡，两瓶水也一起算。' +
          '不急着要，我就想问问你什么时候方便。”食堂的桌面还留着洗洁精的味。',
    choices: [
      {
        id: 'repay_meal',
        label: '连本带利还回去',
        hint: '花点钱，别让小事变大',
        outcome:
          '你数了七十块推过去，他推回来十块，你没收。他挠挠头，说“那我明天请你喝汽水”，' +
          '两个人都笑了，筷子在碗边碰了一下。',
        effect: { favor: { resolve: 'repay' } },
      },
      {
        id: 'delay_meal',
        label: '下次一起吃饭再说',
        hint: '钱不多，他会记账',
        outcome:
          '你说“下次一起吃饭，我请”。他“嗯”了一声，把卡收回兜里。可接下来两周，' +
          '你们再没一起吃过饭。',
        effect: { favor: { resolve: 'delay' } },
      },
      {
        id: 'refuse_meal',
        label: '几十块钱而已',
        hint: '小事不还，最伤交情',
        outcome:
          '你说“就几十块钱，至于吗”。他没接话，站起来把餐盘端走了，背影在食堂人群里晃了两下' +
          '就看不见了。',
        effect: { favor: { resolve: 'refuse' } },
      },
    ],
  },

  /* ==================================================================== *
   *  ④ 老师开小灶（数学老师）：办公室里最后亮着的那盏灯
   * ==================================================================== */
  {
    id: 'favor_offer_tutoring',
    name: '办公室里的一节课',
    icon: '🧮',
    kind: 'choice',
    weight: 8,
    text:
      '数学卷子发下来，最后一道压轴题你只写了一个“解”。放学后{math}在走廊上把你叫住：' +
      '“来办公室，我给你讲四十分钟。”走廊的灯已经熄了一半，办公室里只剩他桌上那一盏。',
    choices: [
      {
        id: 'accept_tutoring',
        label: '留下来听完',
        hint: '白得四十分钟，欠老师一份',
        outcome:
          '他在草稿纸上推了满满两页，最后说“这题不难，你只是没见过”。你回宿舍的路上一直在想这句话，' +
          '也想起他桌上那杯凉透的茶。',
        effect: {
          knowledge: { math: 1.8 },
          stats: { mood: 3, fatigue: 1, teacherFavor: 1 },
          favor: { kind: 'tutoring' },
        },
      },
      {
        id: 'ask_one_step',
        label: '只问卡住的那一步',
        hint: '省时间，少听一半',
        outcome:
          '你只问了卡住的那一步，十分钟就听懂了。老师看看表，说“剩下的自己琢磨”，' +
          '把卷子收回文件夹。',
        effect: { knowledge: { math: 0.9 }, npc: { math: 2 }, stats: { mood: 1 } },
      },
      {
        id: 'decline_tutoring',
        label: '说家里有事，先走',
        hint: '不欠，也少学一课',
        outcome:
          '你说家里等着。老师点点头，把卷子合上，说了句“那你自己再想想”。走出校门时天已经黑透了，' +
          '你心里空了一下。',
        effect: { stats: { mood: -2 }, knowledge: { math: 0.3 } },
      },
    ],
  },
  {
    id: 'favor_collect_tutoring',
    name: '档案室的卷子',
    icon: '🧮',
    kind: 'choice',
    chainOnly: true,
    weight: 8,
    text: (game) =>
      game.flags.favorDelayedTutoring
        ? '课间{math}在办公室门口叫住你：“上回说帮我搬卷子，拖了快两周了。”他语气不重，' +
          '办公室里却安静下来，“我不催你，就是想看看你还记不记得自己点过这个头。”'
        : '课间，{math}抱着一摞卷子路过，看见你就停下来：“那天讲完题，我说档案室缺个人手，你当时点了头。' +
          '今天有空吗？四摞，三楼搬一楼。”办公室里飘着粉笔灰。',
    choices: [
      {
        id: 'repay_tutoring',
        label: '留下来搬完',
        hint: '累一点，老师会记得',
        outcome:
          '你跑了四趟，把四摞卷子全搬进档案室，还按年级码齐。老师在门口看着，递给你一瓶水，' +
          '说“搬得比课代表整齐”。',
        effect: { favor: { resolve: 'repay' } },
      },
      {
        id: 'delay_tutoring',
        label: '说今天要打扫卫生',
        hint: '老师没催，但记下了',
        outcome:
          '你说“下节课我有事，晚点搬”。他点点头，把卷子往墙角挪了挪，说“那我先放着”。' +
          '那摞卷子在墙角放了三天，你每次路过都看见。',
        effect: { favor: { resolve: 'delay' } },
      },
      {
        id: 'refuse_tutoring',
        label: '装作没听见',
        hint: '装忘，办公室传得快',
        outcome:
          '你说“那天我只是去听题”。老师愣了一下，把卷子抱起来自己走了。经过你身边时，他没再说话，' +
          '办公室门口有几个同学抬起头。',
        effect: { favor: { resolve: 'refuse' } },
      },
    ],
  },

  /* ==================================================================== *
   *  ⑤ 对手错题本（老对手）：红榜上只差几分的那两个人
   * ==================================================================== */
  {
    id: 'favor_offer_rival_paper',
    name: '错题本上的字',
    icon: '📄',
    kind: 'choice',
    weight: 8,
    text:
      '红榜贴出来那天，你和{rival}的名次又挨在一起。晚自习他走过来，把一本蓝皮错题本推到你桌上：' +
      '“我整理了三遍的，你拿去复印。”他别过头补了一句，“别误会，我就是不想下次赢一个没准备好的人。”',
    choices: [
      {
        id: 'accept_rival_paper',
        label: '接过来，说声谢',
        hint: '对手的人情最重',
        outcome:
          '你把本子抱回座位，那一晚翻到很晚。有些题他写得比老师还细，页边还有一行小字：' +
          '“这题我错过两次。”',
        effect: {
          knowledge: { physics: 1.6, all: 0.3 },
          stats: { mood: 2 },
          favor: { kind: 'rival_paper' },
        },
      },
      {
        id: 'look_at_red',
        label: '只看他标红的那几页',
        hint: '当天就还，不算欠',
        outcome:
          '你在他桌边站着看了十几分钟，把他标红的题抄进本子，下午就把错题本还了回去。' +
          '他接过去翻了一下，说“行，还挺讲究”。',
        effect: { knowledge: { physics: 0.8 }, npc: { rival: 2 } },
      },
      {
        id: 'decline_rival_paper',
        label: '"不用，我自己有"',
        hint: '保持距离，谁也不欠',
        outcome:
          '"行。"他把本子收回去，"那下次考场上见。"你们俩都笑了一下。走出教室时你发现手心有点汗。',
        effect: { npc: { rival: 3 }, stats: { mood: 1, discipline: 1 } },
      },
    ],
  },
  {
    id: 'favor_collect_rival_paper',
    name: '考前的那份笔记',
    icon: '📄',
    kind: 'choice',
    chainOnly: true,
    weight: 8,
    text: (game) =>
      game.flags.favorDelayedRival
        ? '{rival}把话摊开说：“错题本的事我记着，笔记你说等考完。现在离月考还有三天。”' +
          '他敲了敲栏杆，“我不是来讨说法的，我是真怕考砸。”'
        : '{rival}在晚自习的走廊上叫住你，抱着胳膊靠在栏杆：“错题本给你看了两周。我物理电学那块一直虚，' +
          '下回月考之前，你的笔记借我过一遍。”他顿了顿，“你现在不用答应，想清楚再说。”',
    choices: [
      {
        id: 'repay_rival_paper',
        label: '把笔记摊开讲一遍',
        hint: '把对手喂强，也把自己讲明白',
        outcome:
          '你搬了把凳子坐到他对面，一页一页讲到熄灯。讲到第三道题他忽然说“原来你是这么记的”，' +
          '你才发现自己有些地方讲得比以为的清楚。',
        effect: { favor: { resolve: 'repay' } },
      },
      {
        id: 'delay_rival_paper',
        label: '等考完再说',
        hint: '人情比你想象的重',
        outcome: '你说“你成绩已经够好了，缓缓吧”。他盯了你两秒，说“行”，笑了一下，那种笑让你不太舒服。',
        effect: { favor: { resolve: 'delay' } },
      },
      {
        id: 'refuse_rival_paper',
        label: '这本错题本来就是我该看的',
        hint: '从对手变陌生人',
        outcome:
          '你说“那本错题本我本来也快找到了”。他“哈”了一声，把搭在栏杆上的手臂收回来，说“那算了”，' +
          '转身进了教室。',
        effect: { favor: { resolve: 'refuse' } },
      },
    ],
  },

  /* ==================================================================== *
   *  ⑥ 爸妈挡家长会（爸妈）：回家只煮了一碗面
   * ==================================================================== */
  {
    id: 'favor_offer_parents_cover',
    name: '替你去开的家长会',
    icon: '🏠',
    kind: 'choice',
    weight: 8,
    text:
      '这次成绩单实在不好看，家长会你不想让家里人来。晚上吃饭时，{parents}把手机放下：' +
      '“明天我去吧，跟你老师说你在家也学到很晚。”桌上那盘菜没人动，你爸的筷子搁在了碗边。',
    choices: [
      {
        id: 'accept_parents_cover',
        label: '点头，让他们去',
        hint: '躲过一次，他们记着',
        outcome:
          '家长会那天他们去了，回来只煮了面，一句没提老师说了什么。你低头吃面，汤有点咸，' +
          '始终没敢抬头看他们。',
        effect: { stats: { mood: 2, fatigue: -2 }, favor: { kind: 'parents_cover' } },
      },
      {
        id: 'face_parents_meeting',
        label: '自己去和老师说清楚',
        hint: '不欠，会被说几句',
        outcome:
          '你自己去找了老师，在办公室站了十分钟，被说了几句。回家路上给家里打电话说“这次没考好”，' +
          '你妈只说“知道了，早点睡”。',
        effect: { stats: { teacherFavor: 2, mood: -3, discipline: 1 }, npc: { parents: 2 } },
      },
      {
        id: 'hide_notice',
        label: '说家长会取消了',
        hint: '省一场谈话，纸包不住火',
        outcome:
          '你把通知单塞进书包夹层，说学校通知取消了。他们没多问，饭桌上你爸给你夹了一筷子菜，' +
          '你嚼了很久才咽下去。',
        effect: {
          stats: { mood: -2 },
          npc: { parents: -2 },
          risk: [
            {
              chance: 0.35,
              text: '',
              effect: {
                text:
                  '家长会第二天，班主任在家长群里发了签到表。你妈拿着手机站在你房门口，' +
                  '没有骂你，只是问了一句“为什么不让我们去”。',
                stats: { mood: -6 },
                npc: { parents: -6, head: -2 },
              },
            },
          ],
        },
      },
    ],
  },
  {
    id: 'favor_collect_parents_cover',
    name: '周末那顿饭',
    icon: '🏠',
    kind: 'choice',
    chainOnly: true,
    weight: 8,
    text: (game) =>
      game.flags.favorDelayedParents
        ? '周五的电话又来了，你妈先说的是“不回也没事”，顿了顿才说“你爸把菜都买好了，放冰箱里”。' +
          '上回你说等考好再说，一周已经过去，她没再问第二次。'
        : '周五晚上，{parents}打来电话：“这周回来吃饭吗？你爸买了你爱吃的菜。”家长会那天的事谁也没再提，' +
          '可电话那头安静了一会儿，你妈才又补了一句“回来吧，就吃个饭”。',
    choices: [
      {
        id: 'repay_parents_cover',
        label: '把实话说了',
        hint: '比考高分更让他们安心',
        outcome:
          '周日你提早回了家，把最近的成绩和打算一条条说完。你爸听完只说了句“早说不就完了”，' +
          '转头进厨房又加了一个菜。那顿饭吃得很慢。',
        effect: { favor: { resolve: 'repay' } },
      },
      {
        id: 'delay_parents_cover',
        label: '等考好了再说',
        hint: '他们没催，面会凉',
        outcome:
          '你说“这周要补课，下次吧”。你妈说“行，别太累”，挂了电话。你低头看桌上没写完的卷子，' +
          '忽然觉得那个“下次”很远。',
        effect: { favor: { resolve: 'delay' } },
      },
      {
        id: 'refuse_parents_cover',
        label: '吃完就回屋了',
        hint: '家里的人也会寒心',
        outcome:
          '你回了家，进门把书包一放就进了房间。晚饭时你妈敲了两次门，你说不饿。隔着门缝，' +
          '你听见你爸把电视声音调小了一点。',
        effect: { favor: { resolve: 'refuse' } },
      },
    ],
  },
];
