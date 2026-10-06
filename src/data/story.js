/**
 * 剧情线（故事）。
 *
 * 一条线 = 一个人（或一件事）+ 若干"章节"。章节是**强制触发**的：
 * 只要条件满足，下一周行动结束后一定会弹出这一章，不会跟随机事件抢。
 *
 * 章节字段：
 *   id        章节 id（同一条线内唯一）
 *   title     章节标题
 *   week      第几周（game.turn）之后才能触发，默认 0
 *   requires  可选门槛 { npc: '好感键', min: 数值 } / { flag: 'flag 名' }
 *   text      (game, cast) => 旁白文字；cast 是 game.cast.map（id → 人物对象）
 *   effect    可选，跟事件一样的 effect（stats / npc / money / knowledge / flags）
 *   flags     可选，直接写进 game.flags 的标记
 *   choices   可选，给了就是"有选项"的章节：
 *               { id, label, hint, outcome: (game, cast) => 文字, effect }
 *
 * 名字请用 cast 里的字段（cast.deskmate.name 等），不要写死"张昊""王老师"。
 */

/** 家里那盏灯：父母线。 */
const FAMILY_ARC = {
  id: 'family',
  title: '家里那盏灯',
  icon: '🏠',
  person: 'father',
  intro: '你考多少分，他们都在客厅等你回来。',
  chapters: [
    {
      id: 'f1',
      title: '夜宵',
      week: 1,
      text: (game, cast) =>
        `晚上十点半，你推开家门，${cast.mother.name}还在厨房。她没问你作业写完没有，只是把一碗热好的面推到你面前：\n` +
        `“先吃。你眼睛下面都是青的。”\n你低头吃面，听见${cast.father.name}在客厅把电视音量调低了两格。`,
      effect: { stats: { mood: 3, fatigue: -2 }, npc: { parents: 4 } },
    },
    {
      id: 'f2',
      title: '家长会之后',
      week: 6,
      text: (game, cast) =>
        `${cast.father.name}从家长会回来，把你的成绩条摊在饭桌上——他看不太懂，只是用指甲在年级排名那一行划了一下。\n` +
        `“我不懂这些。”他顿了很久，“但你要是累了，就跟我说。”\n` +
        `你忽然发现，他鬓角的白头发比开学时多了。`,
      effect: { npc: { parents: 6 }, stats: { mood: 2 } },
    },
    {
      id: 'f3',
      title: '一碗汤的距离',
      week: 14,
      requires: { npc: 'parents', min: 40 },
      text: (game, cast) =>
        `期中成绩下来那天你没敢回家，在小区门口的路灯下来回走了四圈。\n` +
        `最后是${cast.mother.name}下楼来找你：“站在这儿干什么，风大。”她手里端着一个保温桶。\n` +
        `“排骨汤，凉了就不好喝了。”她说，“分数的事，明天再说。”`,
      effect: { stats: { mood: 6, fatigue: -3 }, npc: { parents: 6 } },
      flags: { familyWarm: true },
    },
    {
      id: 'f4',
      title: '他们说，你只管考',
      week: 26,
      text: (game, cast) =>
        `离高考还有一百天。饭桌上，${cast.father.name}把筷子放下，说了句他憋了很久的话：\n` +
        `“家里的事你不用管，你只管考。”${cast.mother.name}在旁边点头，眼睛却看着碗。\n` +
        `你忽然不知道该说什么。`,
      choices: [
        {
          id: 'accept',
          label: '点头，把这份压力变成动力',
          hint: '心情 +，疲劳 +',
          outcome: (game, cast) => `你点头。${cast.father.name}松了一口气，起身去阳台抽烟。你在心里把那句话写了三遍：你只管考。`,
          effect: { stats: { mood: 5, fatigue: 4 }, npc: { parents: 6 } },
        },
        {
          id: 'honest',
          label: '说一句“我有点累”',
          hint: '心情 +，父母关系 +，但他们会担心',
          outcome: (game, cast) =>
            `你说“我有点累”。${cast.mother.name}愣了一下，伸手摸了摸你的头：\n“那就不考那么好了。人比分数要紧。”\n` +
            `你没想到会听见这句话。`,
          effect: { stats: { mood: 10, fatigue: -4 }, npc: { parents: 8 } },
          flags: { familyWarm: true },
        },
        {
          id: 'silent',
          label: '什么都不说，回房间',
          hint: '没有变化，但心里堵着',
          outcome: () => '你把门关上，趴在桌上，听见客厅里两个人小声说了很久的话。你没听清，也不想知道。',
          effect: { stats: { mood: -3 }, npc: { parents: -4 } },
        },
      ],
    },
    {
      id: 'f5',
      title: '高考那天的早饭',
      week: 34,
      text: (game, cast) =>
        `高考第一天，早上六点你就醒了。走出房间，${cast.mother.name}已经在厨房，桌上摆着一根油条、两个鸡蛋——一根油条两个鸡蛋，是一百分的意思。\n` +
        `${cast.father.name}把车钥匙拿在手里：“今天我送你去。”\n` +
        `车里没人说话，但你看见他握方向盘的手在抖。`,
      effect: { stats: { mood: 8, fatigue: -4 }, npc: { parents: 5 } },
    },
  ],
};

/** 同桌线。 */
const DESKMATE_ARC = {
  id: 'deskmate',
  title: '同桌的三年',
  icon: '🧑',
  person: 'deskmate',
  intro: '从借一块橡皮开始，到最后一张毕业照。',
  chapters: [
    {
      id: 'd1',
      title: '第一天就借橡皮',
      week: 0,
      text: (game, cast) =>
        `开学第一天，你旁边的位置坐下一个人。第一节课上到一半，一只胳膊肘轻轻碰了碰你，递过来半块橡皮。\n` +
        `“用一下。”${cast.deskmate.call}小声说，说完自己也笑了，“忘了带。”\n这是你和${cast.deskmate.name}说的第一句话。`,
      effect: { npc: { deskmate: 6 } },
    },
    {
      id: 'd2',
      title: '谁先玩手机谁请奶茶',
      week: 4,
      text: (game, cast) =>
        `${cast.deskmate.call}把手机塞进抽屉最里面，“啪”地扣上：“从今天起，晚自习谁先碰手机谁请奶茶。”\n` +
        `你看着${cast.deskmate.ta}认真的样子，也把自己那台锁了屏。\n那天晚上，两个人都没喝上奶茶。`,
      effect: { npc: { deskmate: 7 }, stats: { mood: 2 } },
      flags: { deskPact: true },
    },
    {
      id: 'd3',
      title: '你把同桌的卷子撕了',
      week: 10,
      text: (game, cast) =>
        `发卷子的时候两个人抢着看，纸在中间“刺啦”一声裂成两半。教室里安静了一秒。\n` +
        `${cast.deskmate.call}什么也没说，把大的那一半捡起来，铺平，压在文具盒下面。\n` +
        `你手里攥着剩下那半张，上面正好是${cast.deskmate.ta}错的那道大题。`,
      choices: [
        {
          id: 'apologize',
          label: '当面道歉，把话说开',
          outcome: (game, cast) =>
            `你追到二楼楼梯口，把话说了。${cast.deskmate.call}沉默了半分钟，说：“我知道你不是故意的。”\n` +
            `第二天${cast.deskmate.ta}照样把笔记推到你桌上，中间那页折了个角。`,
          effect: { npc: { deskmate: 10 }, stats: { mood: 2 } },
        },
        {
          id: 'newcopy',
          label: '默默抄一份新的还回去',
          outcome: (game, cast) =>
            `你花了两个晚自习，把${cast.deskmate.ta}那张卷子从头到尾抄了一遍，连红叉都画上了。\n` +
            `${cast.deskmate.call}翻着看着，忽然笑出声：“你连我错的题都抄对了。”`,
          effect: { npc: { deskmate: 6 }, stats: { mood: 1, fatigue: 3 } },
        },
        {
          id: 'ignore',
          label: '装作没这回事',
          outcome: (game, cast) => `你没提，${cast.deskmate.call}也没提。但接下来一个星期，你们中间那半张桌子像是变宽了一点。`,
          effect: { npc: { deskmate: -8 }, stats: { mood: -3 } },
        },
      ],
    },
    {
      id: 'd4',
      title: '高三的晚自习',
      week: 22,
      requires: { npc: 'deskmate', min: 45 },
      text: (game, cast) =>
        `高三的教室安静得能听见风扇声。${cast.deskmate.call}写完一张卷子，抬头看了你一眼，把自己整理的时间轴推了过来。\n` +
        `“你上次说背不下来。我做成表格了。”\n你们没再说别的。那一晚上，你们各做了两套卷子。`,
      effect: { npc: { deskmate: 8 }, stats: { mood: 3 } },
    },
  ],
};

/** 恋爱线。 */
const LOVE_ARC = {
  id: 'love',
  title: '雨山湖边的远路',
  icon: '💗',
  person: 'love',
  intro: '从跑操时分的那瓶水，到高考前夜那句“考完再说”。',
  chapters: [
    {
      id: 'l1',
      title: '操场边的两分钟',
      week: 3,
      text: (game, cast) =>
        `跑操结束，人潮往教学楼涌。${cast.love.call}不知不觉落在你旁边半步，把一瓶没开封的水塞过来，说是买多了。\n` +
        `梧桐叶刚黄，风把走廊尽头那排树的影子吹得晃动。你说了句谢谢，声音比自己预想的轻。到楼梯口就分开了，那瓶水你一直没舍得喝。`,
      effect: { stats: { mood: 3 }, npc: { love: 6 } },
    },
    {
      id: 'l2',
      title: '传过三排桌子的纸条',
      week: 8,
      requires: { npc: 'love', min: 30 },
      text: (game, cast) =>
        `数学晚自习，一张对折的纸从第三排传过来，最后停在你手边。上面只有一行小字：明早六点四十，雨山湖边那条路，一起走一段。\n` +
        `字写得很用力，纸背都被笔尖戳出了印子。你把纸条叠成更小的一块，塞进笔袋最里层。`,
      effect: { stats: { mood: 4, fatigue: -2 }, npc: { love: 7 } },
      flags: { lakeWalk: true },
    },
    {
      id: 'l3',
      title: '三十五分的那天',
      week: 16,
      requires: { npc: 'love', min: 35 },
      text: (game, cast) =>
        `那天放学你们绕了远路，从健康路一直走到湖边，风把水面吹出一层碎光。\n` +
        `${cast.love.call}忽然停下来，看着鞋尖，问：我们这样，算什么。\n你听见自己的心跳，比跑操的时候还快。`,
      choices: [
        {
          id: 'confess',
          label: '把话说出口',
          hint: '心情大涨，但从此多了一件事要瞒着',
          outcome: (game, cast) =>
            `你说完那句话，${cast.love.call}愣了几秒，然后笑起来，说：我等你这句话等了半个学期。\n` +
            `湖面上有游船慢慢开过去，你们都没再看对方。`,
          effect: { stats: { mood: 10, discipline: -2 }, npc: { love: 12 } },
          flags: { earlyLove: true },
        },
        {
          id: 'wait',
          label: '说等高考完再说',
          hint: '关系往前走一点，但不越线',
          outcome: (game, cast) =>
            `你说，等考完再说吧。${cast.love.call}点点头，把书包带往上提了提：行，那就一起先考完。\n` +
            `回去的路上你们隔着半米走，谁都没觉得远。`,
          effect: { stats: { mood: 4, discipline: 1 }, npc: { love: 5 } },
        },
        {
          id: 'friend',
          label: '说还是做同学好',
          hint: '把心思收回去，但会难受一阵',
          outcome: (game, cast) =>
            `你说还是做同学比较好。${cast.love.call}说了一个“哦”，声音很轻，然后把话题转到了明天的英语默写。\n` +
            `第二天早读，那瓶水的牌子换了，人也坐回了原来的位置。`,
          effect: { stats: { mood: -5 }, npc: { love: -8 } },
        },
      ],
    },
    {
      id: 'l4',
      title: '被留下谈话的那天',
      week: 24,
      requires: { npc: 'love', min: 40 },
      text: (game, cast) =>
        `班会课上，${cast.head.teacher}讲了二十分钟关于早恋的问题，眼睛在你和${cast.love.call}之间停了两次。\n` +
        `下课铃响，你被留下。办公室里只有风扇在转，${cast.head.teacher}没有骂人，只是把你的周记本推回来，说：有些路，晚两年走，一样看得到风景。\n` +
        `你点头，喉咙里像堵着东西。`,
      effect: { stats: { mood: -5, discipline: 2 }, npc: { love: 3, head: 3 } },
      flags: { loveKnown: true },
    },
    {
      id: 'l5',
      title: '高考前一夜',
      week: 34,
      requires: { npc: 'love', min: 40 },
      text: (game, cast) =>
        `高考前一夜，晚自习提前放了。你们在湖边的长椅上坐到九点半，谁也没提分数。\n` +
        `${cast.love.call}说，考完再说，考不好也再说。回去的路上梧桐叶擦着肩膀落下来。\n` +
        `你把这句话在心里念了一路，像念一句只属于自己的口号。`,
      effect: { stats: { mood: 8, fatigue: -3 }, npc: { love: 6 } },
    },
  ],
};

/** 班主任线。 */
const HEAD_ARC = {
  id: 'head',
  title: '办公室里的谈话',
  icon: '👩‍🏫',
  person: 'head',
  intro: '那张找学生谈话的椅子，你三年里坐了很多次。',
  chapters: [
    {
      id: 'h1',
      title: '第一次进办公室',
      week: 2,
      text: (game, cast) =>
        `开学第二周，你因为早读迟到被叫到办公室。${cast.head.teacher}没抬头，先把你上周的作业本翻了一遍，翻到最后一页才说话：字写得不错，就是太急。\n` +
        `然后让你回去。你站在门口愣了几秒，才明白这次谈话原来不算批评。`,
      effect: { stats: { discipline: 2 }, npc: { head: 5 } },
    },
    {
      id: 'h2',
      title: '期中之后的那张椅子',
      week: 9,
      requires: { npc: 'head', min: 30 },
      text: (game, cast) =>
        `期中成绩贴在走廊尽头，红榜下面挤满了人。晚自习前，${cast.head.teacher}把你叫进办公室，让你坐在对面那张空椅子上——整个办公室只有那一张椅子是专门用来找学生谈话的。\n` +
        `成绩单被推过来，笔尖点在数学那一栏：这科你不该考成这样。你自己说，问题在哪。`,
      effect: { stats: { mood: 2, discipline: 2 }, npc: { head: 7 } },
    },
    {
      id: 'h3',
      title: '一个班两个名额',
      week: 17,
      requires: { npc: 'head', min: 45 },
      text: (game, cast) =>
        `教务处下发了优秀学生推荐的通知，一个班两个名额。${cast.head.teacher}把表放在桌上，说想听听你的想法。\n` +
        `窗外是马钢方向灰白的天，烟从远处的烟囱里慢慢升上去。你忽然意识到，这张薄薄的表格，可能会改变后面两年的路。`,
      choices: [
        {
          id: 'take',
          label: '举手，说我想试试',
          hint: '推荐名额 +，但会占掉一些自己的时间',
          outcome: (game, cast) =>
            `你说，我想试试。${cast.head.teacher}点点头，在表格上写下你的名字，笔尖压得很重。\n` +
            `出门时听见里面在喊下一个，走廊里的光很白。`,
          effect: { stats: { mood: 4, comprehensive: 4, fatigue: 2 }, npc: { head: 6 } },
          flags: { recommended: true },
        },
        {
          id: 'give',
          label: '让给更需要的同学',
          hint: '老师记住这句话，但机会没了',
          outcome: (game, cast) =>
            `你说，班上有人比我更需要这个。${cast.head.teacher}看了你很久，把表收了回去，说：这句话我记下了。\n` +
            `回教室的路上你想了一路，也说不清自己后不后悔。`,
          effect: { stats: { mood: 2, social: 3 }, npc: { head: 10 } },
          flags: { recommendGiven: true },
        },
        {
          id: 'ask',
          label: '先问清楚这到底意味着什么',
          hint: '少一点冲动，多一点信息',
          outcome: (game, cast) =>
            `你问了三个问题：占不占时间、要不要另外考试、对自招有没有用。\n` +
            `${cast.head.teacher}一条一条答完，最后笑了一下：全校没几个学生会这么问。`,
          effect: { stats: { comprehensive: 2, mood: 1 }, npc: { head: 4 } },
        },
      ],
    },
    {
      id: 'h4',
      title: '一模之后',
      week: 26,
      requires: { npc: 'head', min: 40 },
      text: (game, cast) =>
        `一模成绩单发下来那天，你把卷子揉进抽屉最里面。${cast.head.teacher}没有在班上念排名，只是在放学后把你留在教室，递过来一杯热水。\n` +
        `我教过一届学生，平时一直在一百名上下，最后考进了前三十。${cast.head.teacher}没说是谁，你也知道那是安慰。`,
      effect: { stats: { mood: 8, fatigue: -3 }, npc: { head: 6 } },
    },
    {
      id: 'h5',
      title: '最后一次班会',
      week: 34,
      text: (game, cast) =>
        `最后一次班会，${cast.head.teacher}没讲题目，只让每个人在小纸条上写一句给三年后的自己。\n` +
        `纸条收上去之后，说了毕业前的最后一句话：你们以后会遇到很多次排名，但只有一次十八岁。\n` +
        `教室里安静了几秒，然后有人开始鼓掌。`,
      effect: { stats: { mood: 8, comprehensive: 2 }, npc: { head: 5 } },
    },
  ],
};

/** 竞争对手线。 */
const RIVAL_ARC = {
  id: 'rival',
  title: '红榜上的另一个名字',
  icon: '⚔️',
  person: 'rival',
  intro: '三年里你们隔着几行名次，互相盯着对方的背影。',
  chapters: [
    {
      id: 'r1',
      title: '差三分',
      week: 5,
      text: (game, cast) =>
        `月考红榜贴出来，${cast.rival.call}的名字就在你上面一行，总分差三分。课间人来人往，两个人都假装在看别的地方。\n` +
        `晚自习你翻开错题本，发现前面几页被人折过角——想起来了，昨天这本书借出去过一节课。`,
      effect: { stats: { mood: 2 }, npc: { rival: 6 } },
    },
    {
      id: 'r2',
      title: '一种奇怪的默契',
      week: 12,
      text: (game, cast) =>
        `从那以后，你们开始了一种奇怪的默契：${cast.rival.call}报了物理竞赛的初选，你也报了；你开始每天多做一套英语完形，第二天就看见对方桌上多了一本一模一样的练习册。\n` +
        `谁都没说过一句话，但两个人都知道。`,
      effect: { stats: { fatigue: 3, comprehensive: 2 }, npc: { rival: 5 } },
    },
    {
      id: 'r3',
      title: '把笔记本放在桌角',
      week: 18,
      requires: { npc: 'rival', min: 35 },
      text: (game, cast) =>
        `竞赛集训缺了两周课，你的化学笔记空了一大片。晚自习，${cast.rival.call}把那本写满批注的本子放在你桌角，转身就走。\n` +
        `本子很厚，边上夹着一张便签：看不懂的地方圈出来。你抬头的时候，人已经回到座位上了。`,
      choices: [
        {
          id: 'borrow',
          label: '借，并且认真补完',
          hint: '关系大步向前，但要花掉一个周末',
          outcome: (game, cast) =>
            `你花了一个周末把空页补满，每一页都写了批注。还回去的时候，${cast.rival.call}翻了两页，什么也没说，只是把本子收进抽屉最里面。\n` +
            `下周的化学小测，你们并列第一。`,
          effect: { stats: { mood: 4, fatigue: 3, comprehensive: 3 }, npc: { rival: 10 } },
          flags: { rivalNotes: true },
        },
        {
          id: 'copy',
          label: '只抄结论，过程自己来',
          hint: '省时间，但少了一点坦诚',
          outcome: (game, cast) =>
            `你把结论抄完就还了回去。${cast.rival.call}接过去的时候顿了一下，还是说了句不用谢。\n` +
            `你们的关系没变差，只是也就到这儿了。`,
          effect: { stats: { mood: 1, comprehensive: 1 }, npc: { rival: 2 } },
        },
        {
          id: 'refuse',
          label: '说不用，我自己补',
          hint: '面子保住了，人情欠下了',
          outcome: (game, cast) =>
            `你说不用。${cast.rival.call}把本子拿回去，塞进书包。\n` +
            `从那以后，那点无声的默契淡了半个月，直到下一次月考的红榜贴出来。`,
          effect: { stats: { fatigue: 4, comprehensive: 3 }, npc: { rival: -4 } },
        },
      ],
    },
    {
      id: 'r4',
      title: '三模只差一分',
      week: 27,
      text: (game, cast) =>
        `三模的成绩从教务处一路传到教室。你们两个的总分只差一分，这一次是你高。\n` +
        `放学路上，${cast.rival.call}从后面追上来，说：下次不会了。路灯刚亮，两个人都笑了，像是终于把憋了两年的话说出口。`,
      effect: { stats: { mood: 6, comprehensive: 2 }, npc: { rival: 8 } },
    },
    {
      id: 'r5',
      title: '考完之后',
      week: 34,
      text: (game, cast) =>
        `最后一场考完，校门口的家长把整条健康路堵住了。你在人群里看见${cast.rival.call}，隔着几米远。\n` +
        `谁也没喊谁，只是互相抬了一下下巴。三年来第一次，你们不用再比了。`,
      effect: { stats: { mood: 6 }, npc: { rival: 6 } },
    },
  ],
};

/** 死党线。 */
const FRIEND_ARC = {
  id: 'friend',
  title: '团结广场后巷',
  icon: '🧢',
  person: 'friend',
  intro: '翻墙、兜底、天台上的约定，还有最后那碗小刀面。',
  chapters: [
    {
      id: 'fr1',
      title: '后巷那家网吧',
      week: 4,
      text: (game, cast) =>
        `周三下午最后一节是自习。${cast.friend.call}在桌子底下用鞋尖踢你，压低声音说：后巷那家网吧新开的，两块钱一小时，去不去。\n` +
        `窗外正是下午四点的光，黑板报上还留着上周的粉笔灰。你握着笔，笔尖在草稿纸上停住了。`,
      choices: [
        {
          id: 'go',
          label: '去，反正就这一次',
          hint: '心情大涨，违纪也跟着涨',
          outcome: (game, cast) =>
            `你们从操场后面的矮墙翻出去，走了十分钟。网吧里烟味很重，屏幕很亮。\n` +
            `两个小时以后出来，天已经黑了，你忽然想起今天的物理作业一个字都没写。`,
          effect: { stats: { mood: 8, discipline: -6, fatigue: 4 }, npc: { friend: 10 } },
          flags: { skippedClass: true },
        },
        {
          id: 'stay',
          label: '按住书包带，说今天不行',
          hint: '纪律 +，但对方会不高兴一小会儿',
          outcome: (game, cast) =>
            `你按住${cast.friend.ta}的书包带，说今天不行。${cast.friend.call}骂了你一句，趴在桌上睡了半节课。\n` +
            `放学的时候，还是和你一起走的。`,
          effect: { stats: { discipline: 3, mood: -2 }, npc: { friend: 4 } },
        },
        {
          id: 'canteen',
          label: '提议改去食堂二楼吃面',
          hint: '折中的办法，花一点钱',
          outcome: (game, cast) =>
            `你提议去食堂二楼，点了两碗小刀面。吃完出来，${cast.friend.call}说行吧，下次再说。\n` +
            `你们都知道没有下次。`,
          effect: { stats: { mood: 4, social: 3 }, npc: { friend: 6 }, money: -20 },
        },
      ],
    },
    {
      id: 'fr2',
      title: '兜底',
      week: 11,
      requires: { npc: 'friend', min: 30 },
      text: (game, cast) =>
        `运动会前一天的班级值日，你把教室后墙的展板碰倒了。班主任站在门口，${cast.friend.call}先开口：是我撞的。\n` +
        `你张了张嘴，没说出话。那天下午，你们一起用胶带把展板重新贴了一遍，谁也没提这件事。`,
      effect: { stats: { mood: 5 }, npc: { friend: 10 } },
      flags: { friendCover: true },
    },
    {
      id: 'fr3',
      title: '天台上的约定',
      week: 20,
      requires: { npc: 'friend', min: 35 },
      text: (game, cast) =>
        `高二暑假前的最后一晚，你们爬到教学楼天台。风从江那边吹过来，城市的路灯一盏一盏亮着。\n` +
        `${cast.friend.call}说：三年以后，不管考哪儿，我们都在同一座城市。你说好。\n` +
        `其实你们都知道这句话做不了数。`,
      effect: { stats: { mood: 8 }, npc: { friend: 8 } },
    },
    {
      id: 'fr4',
      title: '隔壁班的那个人',
      week: 29,
      text: (game, cast) =>
        `高三以后，${cast.friend.call}换到了隔壁班。走廊里遇见，两个人点点头就过去了。\n` +
        `有一次你在小卖部听见别人说，最近天天在打球。你想说点什么，最后只是把水递过去，说：别太累。对方愣了一下，接了。`,
      effect: { stats: { mood: -2 }, npc: { friend: 3 } },
    },
    {
      id: 'fr5',
      title: '最后一碗小刀面',
      week: 34,
      text: (game, cast) =>
        `高考结束那天下午，${cast.friend.call}在校门口等你，说去食堂二楼。面端上来的时候，两个人都不太会说话。\n` +
        `最后是先开口的：那句话说错了，我们可能不在一个城市。你说，那就常回来。\n` +
        `面汤很烫，谁都没抬头。`,
      effect: { stats: { mood: 10, fatigue: -4 }, npc: { friend: 8 } },
    },
  ],
};

/** 里程碑线：不挂好感门槛，只写三年里的那些日子。 */
const SCHOOL_ARC = {
  id: 'school',
  title: '三年里的那些日子',
  icon: '🏫',
  person: 'head',
  intro: '军训、运动会、艺术节、百日誓师、成人礼、毕业照。',
  chapters: [
    {
      id: 's1',
      title: '军训',
      week: 0,
      text: (game, cast) =>
        `八月底的太阳把操场晒得发白。你们穿着刚发下来的迷彩服，站了四十分钟军姿，汗从下巴滴到鞋面上。\n` +
        `教官喊原地休息的时候，没有人先坐下，都先看旁边的人有没有晃。\n` +
        `那是高中三年里，${game.student.className}第一次站得那么齐。`,
      effect: { stats: { physique: 3, fatigue: 4, mood: 2 }, npc: { deskmate: 2 } },
    },
    {
      id: 's2',
      title: '运动会',
      week: 5,
      text: (game, cast) =>
        `运动会第二天的四百米，报名表上原本空着一格，最后是班里最瘦的那个人去跑的，拿了第三名。\n` +
        `看台上的红布条被风吹得乱响，你们把嗓子喊哑了，晚自习全班都没精神。\n` +
        `现在想起来，那是三年里最不值钱的一个下午，也是最值钱的一个。`,
      effect: { stats: { mood: 5, social: 3, fatigue: 3 } },
    },
    {
      id: 's3',
      title: '艺术节',
      week: 10,
      text: (game, cast) =>
        `艺术节的舞台搭在操场东边。排练了三个星期的小品，上台前十分钟道具坏了，最后临时改成朗读。\n` +
        `台下亮起一片手机的手电筒，把稿纸照得发白。谢幕的时候，你听见最前排有人在喊你们班的名字。`,
      effect: { stats: { mood: 6, comprehensive: 3, social: 2 } },
    },
    {
      id: 's4',
      title: '采石矶的春游',
      week: 14,
      text: (game, cast) =>
        `春游那天大巴开了四十分钟，停在采石矶门口。江面上有雾，矶头那块石刻被摸得发亮。\n` +
        `自由活动一个小时，有人挤在牌坊前拍照，有人蹲在台阶上写题。`,
      choices: [
        {
          id: 'photo',
          label: '挤进去拍张照',
          hint: '心情 +，社交 +',
          outcome: (game, cast) =>
            `你被推到人群最中间，喊了三二一。照片洗出来的时候，每个人都笑得很傻，那张纸后来被夹在了毕业册里。`,
          effect: { stats: { mood: 5, social: 3, fatigue: -3 } },
        },
        {
          id: 'drill',
          label: '找个阴凉处写一套卷子',
          hint: '综合素质 +，但累',
          outcome: () => `你在江边的石凳上摊开卷子，风把纸角吹得直响。写完最后一道大题，抬头才发现同学都已经走远了。`,
          effect: { stats: { comprehensive: 3, fatigue: 3, mood: -2 } },
        },
        {
          id: 'walk',
          label: '一个人沿江走一段',
          hint: '心情 +，想明白一些事',
          outcome: () => `你沿着江堤走了很远，雾一直没散。回来的时候导游旗已经在收，没人问你去了哪儿。`,
          effect: { stats: { mood: 4, comprehensive: 2, fatigue: -2 } },
        },
      ],
    },
    {
      id: 's5',
      title: '百日誓师',
      week: 30,
      text: (game, cast) =>
        `距离高考一百天，全年级在操场上集合。气球升上去的时候，有人的手抖了一下，绳子松了，气球自己飘走了。\n` +
        `你跟着念完那段誓词，声音混在几千个人中间，听不出哪一句是自己的。散场以后，教室里安静得不像话。`,
      effect: { stats: { mood: 5, comprehensive: 2, fatigue: 3 } },
    },
    {
      id: 's6',
      title: '成人礼',
      week: 32,
      text: (game, cast) =>
        `成人礼在报告厅举行，家长坐在后面两排。你穿着借来的正装，觉得浑身不自在。\n` +
        `轮到你上台的时候，你在人群里找了一圈，才看见${cast.father.name}举着手机在拍，拍糊了也没放下。\n` +
        `下台以后，谁都没提这件事。`,
      effect: { stats: { mood: 8, comprehensive: 3 }, npc: { parents: 5 } },
    },
    {
      id: 's7',
      title: '毕业照',
      week: 34,
      text: (game, cast) =>
        `毕业照定在高考后第一天。所有人挤在台阶上，老师坐在第一排。\n` +
        `摄影师喊三二一的时候，几乎没人看镜头——都在扭头找旁边那个人。快门响过之后，人群散开得像放学的课间一样快。\n` +
        `你站在原地看了几秒，才跟着往校门走。`,
      effect: { stats: { mood: 10, comprehensive: 2, social: 2 } },
    },
  ],
};

export const STORY_ARCS = [FAMILY_ARC, DESKMATE_ARC, LOVE_ARC, HEAD_ARC, RIVAL_ARC, FRIEND_ARC, SCHOOL_ARC];

export const STORY_ARC_MAP = Object.fromEntries(STORY_ARCS.map((arc) => [arc.id, arc]));

/** 全部章节数。 */
export const STORY_CHAPTER_COUNT = STORY_ARCS.reduce((sum, arc) => sum + arc.chapters.length, 0);
