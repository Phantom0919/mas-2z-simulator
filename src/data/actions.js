/**
 * 玩家可以执行的行动。
 *
 * phase: 'main'     —— 只能作为每周主行动
 *        'weekend'  —— 只能作为周末安排
 *        'both'     —— 两边都能做（周末做效果会打折）
 *
 * effect 字段（由 engine 统一解释，并叠加天赋 / 道具 / 周末系数）：
 *   stats      { 属性: 变化量 }
 *   npc        { head|math|deskmate|parents|love: 好感变化 }
 *   knowledge  { all: 均值 }            全科
 *              { subject: 均值 }        当前选中的科目
 *              { weakest: 均值, count } 最弱的 N 科
 *              { random: 均值, count }  随机 N 科
 *              { math: 均值, ... }      指定科目
 *   money      零花钱变化
 *   flags      { 标记: 值 }
 *   risk       [{ chance, text, effect }] 概率触发的额外剧情
 *   text       行动旁白（支持 {subject} / {name} 占位符）
 *
 * once: true 表示一局只能做一次（做完就从列表里消失）。
 */

export const ACTION_TAGS = ['学习', '运动', '娱乐', '生活', '关系', '特长', '大事'];

export const ACTIONS = [
  /* ------------------------------------------------------------ 学习 */
  {
    id: 'listen',
    name: '认真听课',
    icon: '📖',
    tag: '学习',
    phase: 'main',
    desc: '跟着老师把六门课过一遍，笔记写满两页。',
    text: '你坐在第三排靠窗的位置，把手机塞进书包最里层。黑板上的粉笔灰簌簌落下，一节课下来手有点酸。',
    effect: {
      knowledge: { all: 3.4 },
      stats: { teacherFavor: 2.5, mood: -1.2, fatigue: 2.5, comprehensive: 0.6 },
    },
  },
  {
    id: 'drill',
    name: '刷题（选科）',
    icon: '✍️',
    tag: '学习',
    phase: 'both',
    needsSubject: true,
    desc: '死磕一个科目，把一整本练习册刷到卷边。',
    text: '你选了{subject}。错题本又厚了三毫米，笔芯用空了两支。',
    effect: {
      knowledge: { subject: 11.2 },
      stats: { mood: -2.2, fatigue: 5, teacherFavor: 0.8 },
    },
  },
  {
    id: 'review_notes',
    name: '整理错题本',
    icon: '🗂️',
    tag: '学习',
    phase: 'both',
    desc: '不刷新题，只把错过的题重做一遍——稳，但见效慢。',
    text: '你把三个月来的错题按知识点重新分类，用三种颜色的笔标出"必错""粗心""不会"。',
    effect: {
      knowledge: { all: 1.9 },
      stats: { fatigue: 2, comprehensive: 1.5, mood: -0.5 },
    },
  },
  {
    id: 'preview',
    name: '早读加晚练',
    icon: '🌅',
    tag: '学习',
    phase: 'main',
    desc: '六点半到校早读，晚自习留到最后关灯。',
    text: '早读铃响之前你就到了教室，晚自习结束时楼道里只剩你们班还亮着灯。',
    effect: {
      knowledge: { all: 1.45, random: 1.45, count: 2 },
      stats: { fatigue: 4.5, mood: -1.4, teacherFavor: 2.5 },
    },
  },
  {
    id: 'cram',
    name: '考前突击',
    icon: '⏰',
    tag: '学习',
    phase: 'main',
    needsSubject: true,
    cooldown: 3,
    desc: '临考前的爆发式复习，效率极高但非常伤身。',
    text: '你连着几个晚上在台灯下熬到一点，桌上堆满草稿纸和速溶咖啡。{subject}的题型被你摸了个遍。',
    effect: {
      knowledge: { subject: 15.7 },
      stats: { mood: -3.5, fatigue: 11, physique: -1.5 },
      risk: [
        {
          chance: 0.22,
          text: '熬夜熬过头，你在早读时直接趴倒睡着，被年级主任拍照发了通报。',
          effect: { stats: { discipline: 5, teacherFavor: -4, mood: -2 } },
        },
      ],
    },
  },
  {
    id: 'tutor',
    name: '报补习班',
    icon: '🏫',
    tag: '学习',
    phase: 'weekend',
    cooldown: 2,
    desc: '周末去大华广场楼上的辅导机构，补最弱的两科。',
    text: '大华国际广场十七楼的补习班里全是熟面孔——半个年级都在这里。老师讲得确实比学校细。',
    effect: {
      knowledge: { weakest: 7.8, count: 2 },
      money: -150,
      stats: { fatigue: 3.5, mood: -1, comprehensive: 0.5 },
    },
    requirement: (game) => (game.stats.money < 150 ? '零花钱不够交学费了（需要 150 元）' : null),
  },
  {
    id: 'help',
    name: '给同学讲题',
    icon: '🧑‍🏫',
    tag: '学习',
    phase: 'both',
    needsSubject: true,
    desc: '把这一科的难题讲给同桌听——讲明白才算真会。',
    text: '你给同桌讲了整整两节晚自习的{subject}。讲到第三遍的时候，你自己突然也懂了。',
    effect: {
      knowledge: { subject: 2.8, all: 0.4 },
      npc: { deskmate: 4 },
      stats: { social: 2.5, teacherFavor: 3, fatigue: 1.5 },
    },
  },
  {
    id: 'ask_teacher',
    name: '找老师答疑',
    icon: '🙋',
    tag: '关系',
    phase: 'both',
    desc: '下课后追着老师问问题，问到老师都笑了。',
    text: '你拿着写满问号的草稿纸堵在办公室门口。{math}给你讲了二十分钟，最后说："这个问题问得好。"',
    effect: {
      knowledge: { random: 2.2, count: 2 },
      npc: { math: 5, head: 2 },
      stats: { teacherFavor: 3, fatigue: 1.5, comprehensive: 1 },
    },
  },
  {
    id: 'study_together',
    name: '和同桌一起自习',
    icon: '🪑',
    tag: '关系',
    phase: 'both',
    desc: '两个人互相监督，比一个人熬着强。',
    text: '你和{deskmate}约好谁先玩手机就请对方喝奶茶。结果两个人一下午都没碰手机。',
    effect: {
      knowledge: { all: 1.3 },
      npc: { deskmate: 7 },
      stats: { mood: 2, social: 1.5, fatigue: 1.5 },
    },
  },
  {
    id: 'contest',
    name: '竞赛辅导',
    icon: '🏅',
    tag: '特长',
    phase: 'both',
    needsSubject: true,
    cooldown: 3,
    desc: '进竞赛教室刷大学教材，冲省级奖项甚至保送（联赛一年一次，急不来）。',
    text: '竞赛教室在实验楼顶层，里面的人都不太说话。你在{subject}的大学教材里第一次感到"原来还能这样"。',
    effect: {
      knowledge: { subject: 4.5 },
      stats: { fatigue: 6, mood: -1, comprehensive: 2 },
    },
    requirement: (game) => (game.stats.intelligence < 55 ? '智力不足 55，竞赛班老师不收' : null),
    special(game, api) {
      const stage = game.flags.contestStage ?? 0;
      const subjectName = api.subjectName();
      const power = (game.knowledge[api.subject] / 100) * 0.6 + (game.stats.intelligence / 100) * 0.4;
      const bonus = game.mods.contest ?? 0;

      if (stage === 0) {
        game.flags.contestStage = 1;
        api.say(`你通过了选拔，正式进入${subjectName}竞赛校队。教练递给你一本厚得吓人的教材："一年后见分晓。"`);
        return;
      }
      if (stage === 1) {
        if (api.chance(0.4 + power * 0.35 + bonus)) {
          game.flags.contestStage = 2;
          api.say(`市赛出线！你拿到了${subjectName}省赛的资格，胸前别着二中的校徽走进考场。`);
        } else {
          api.say('这次联赛你只拿了安慰奖。教练说："差的那几分，是你高一少刷的那几本。"');
          api.addStat('mood', -3);
        }
        return;
      }
      if (stage === 2) {
        if (api.chance(0.22 + power * 0.3 + bonus)) {
          game.flags.contestStage = 3;
          game.flags.contestProv1 = true;
          api.say('🎉 省一等奖！红榜贴在行政楼门口，你的名字被班主任用红笔圈了三圈。强基计划的敲门砖到手了。');
          api.addStat('teacherFavor', 8);
          api.addNpc('head', 6);
          api.addStat('mood', 8);
        } else {
          api.say('省赛拿了二等奖，离一等奖只差一道大题的最后一问。');
          api.addStat('mood', -2);
        }
        return;
      }
      if (stage === 3) {
        if (api.chance(0.14 + power * 0.26 + bonus)) {
          game.flags.contestStage = 4;
          api.say('你入选省队，去合肥参加集训。同宿舍的人开口就是"这道题我们省队用的方法"。');
          api.addStat('mood', 6);
          api.addStat('comprehensive', 6);
        } else {
          api.say('省队选拔落榜。你在回马鞍山的高铁上把竞赛书翻了一路，没有说一句话。');
          api.addStat('mood', -5);
        }
        return;
      }
      if (stage === 4) {
        if (api.chance(0.08 + power * 0.22 + bonus)) {
          game.flags.contestStage = 5;
          api.say('🏆 国家集训队名单公布，你的名字在上面。清华和北大的招生老师当天就加了你家长的微信。');
          api.endGame('baosong');
        } else {
          api.say('国赛拿了银牌，没能进集训队。不过这块银牌已经足够让强基计划向你招手。');
          game.flags.qiangji = true;
          api.addStat('mood', 3);
        }
        return;
      }
      api.say('你已经站在竞赛路的顶端，剩下的就交给高考了。');
      api.addStat('comprehensive', 3);
    },
  },

  /* ------------------------------------------------------------ 运动 / 生活 */
  {
    id: 'sport',
    name: '操场运动',
    icon: '🏀',
    tag: '运动',
    phase: 'both',
    desc: '去篮球场或跑道上出一身汗，把压力一起排掉。',
    text: '下午最后一节课后，操场上全是人。你和隔壁班的几个家伙打了半场野球，回教室时后背全湿了，心里却松快。',
    effect: {
      stats: { physique: 4.5, mood: 2.6, fatigue: -7, social: 1.2 },
      knowledge: { all: -0.5 },
    },
  },
  {
    id: 'sports_team',
    name: '参加校队训练',
    icon: '🏃',
    tag: '运动',
    phase: 'main',
    cooldown: 2,
    desc: '进校队训练，走体育特长生的路（会影响学习时间）。',
    text: '操场西侧的器材室里，教练把训练计划拍在你手上：每周三次，每次两小时，风雨无阻。',
    effect: {
      stats: { physique: 6.5, fatigue: 6, social: 2, mood: 1.5 },
      knowledge: { all: -1.2 },
      flags: { sportsTeam: true },
    },
    requirement: (game) => (game.stats.physique < 55 ? '体质不足 55，教练摇头了' : null),
  },
  {
    id: 'sleep',
    name: '好好睡觉',
    icon: '😴',
    tag: '生活',
    phase: 'both',
    desc: '这一周不熬夜，十点半准时关灯。',
    text: '你把台灯关掉，躺下的时候听见窗外的雨。第二天早读居然没打瞌睡。',
    effect: {
      stats: { fatigue: -14, mood: 1.4, physique: 0.5 },
      knowledge: { all: 0.2 },
    },
  },
  {
    id: 'canteen',
    name: '食堂加餐',
    icon: '🍚',
    tag: '生活',
    phase: 'both',
    desc: '多打一份红烧肉，好好吃一顿。',
    text: '食堂窗口的红烧肉今天做得特别好。你多加了一份，也多加了一勺汤，吃完觉得整个人都活过来了。',
    effect: {
      money: -35,
      stats: { physique: 2.2, mood: 3, fatigue: -2 },
    },
  },
  {
    id: 'therapy',
    name: '心理咨询',
    icon: '🛋️',
    tag: '生活',
    phase: 'both',
    desc: '去学校心理中心坐一坐，把憋着的话说出来。',
    text: '心理老师给你倒了杯温水，没有问成绩。你说了四十分钟，中间哭了两次，出来时天已经黑了，但呼吸很顺。',
    effect: {
      money: -10,
      stats: { mood: 11, fatigue: -3, teacherFavor: 1 },
    },
    requirement: (game) => (game.stats.mood > 78 ? '现在心情还不错，把机会留给更需要的同学吧' : null),
  },
  {
    id: 'work',
    name: '周末兼职',
    icon: '💼',
    tag: '生活',
    phase: 'weekend',
    cooldown: 2,
    desc: '去马钢家属区的小店帮忙，赚一点自己的零花钱。',
    text: '你在家属区门口的便利店站了两天，理货、收银、搬箱子。老板多给了你二十块，说"学生娃不容易"。',
    effect: {
      money: 230,
      knowledge: { all: -1.4 },
      stats: { fatigue: 9, social: 1.5, physique: 0.6 },
      risk: [
        {
          chance: 0.2,
          text: '搬货时手被纸箱划了道口子，缝了三针，老板塞给你五十块。',
          effect: { stats: { physique: -3, mood: -2 }, money: 50 },
        },
      ],
    },
  },
  {
    id: 'tutor_job',
    name: '给初中生当家教',
    icon: '💵',
    tag: '生活',
    phase: 'weekend',
    cooldown: 2,
    needsSubject: true,
    desc: '把自己最拿手的科目教给别人，赚钱又快又体面。',
    text: '你在小区业主群里发了条广告，第二天就有三个家长加你微信。两小时一百二，讲的是{subject}。',
    effect: {
      money: 260,
      knowledge: { subject: 1.6 },
      npc: { math: 2 },
      stats: { fatigue: 7, social: 2, comprehensive: 2, mood: 1 },
      flags: { tutorJob: true },
    },
    requirement: (game) => {
      const best = Math.max(...game.subjectKeys.map((key) => game.knowledge[key] ?? 0));
      return best < 60 ? '自己还没学明白，没人敢请你当老师' : null;
    },
  },
  {
    id: 'family_time',
    name: '陪家人',
    icon: '🏠',
    tag: '关系',
    phase: 'weekend',
    desc: '回家吃顿饭、陪爸妈说说话。',
    text: '你妈做了一桌菜，你爸难得没提成绩。饭后你陪他们在小区里走了两圈，路灯把三个人的影子拉得很长。',
    effect: {
      npc: { parents: 9 },
      stats: { mood: 5, fatigue: -4, physique: 0.8 },
      money: 50,
    },
  },

  /* ------------------------------------------------------------ 娱乐 */
  {
    id: 'game',
    name: '网吧开黑',
    icon: '🎮',
    tag: '娱乐',
    phase: 'weekend',
    cooldown: 2,
    desc: '和同学溜去团结广场后面的网吧，一坐一下午。',
    text: '团结广场后巷的网吧里烟雾缭绕，隔壁机位坐着你们班的学习委员。五个人开黑到晚上八点，非常快乐。',
    effect: {
      knowledge: { all: -1.2 },
      money: -45,
      stats: { mood: 6.5, discipline: 4, fatigue: -1.5, social: 1 },
      risk: [
        {
          chance: 0.25,
          text: '班主任在网吧门口堵住了你们。他什么都没说，只是让你明天把家长叫来。',
          effect: { stats: { discipline: 12, teacherFavor: -8, mood: -6 }, npc: { head: -10 } },
        },
      ],
    },
  },
  {
    id: 'phone',
    name: '上课摸鱼',
    icon: '📱',
    tag: '娱乐',
    phase: 'main',
    desc: '把手机藏在课本下面刷短视频，一节课四十五分钟过得飞快。',
    text: '你把手机夹在书页中间，屏幕亮度调到最低。物理解题步骤一页没记。',
    effect: {
      knowledge: { all: -0.6 },
      stats: { mood: 3, discipline: 6, teacherFavor: -4, fatigue: 1 },
      risk: [
        {
          chance: 0.3,
          text: '手机被班主任从课桌里抽走了，期末才能领回，还要家长签字。',
          effect: { stats: { discipline: 6, mood: -6, teacherFavor: -5 }, money: -800, npc: { head: -8 } },
        },
      ],
    },
  },
  {
    id: 'social',
    name: '逛街放松',
    icon: '🧋',
    tag: '生活',
    phase: 'weekend',
    cooldown: 2,
    desc: '和同学去金鹰喝奶茶、看电影，聊一晚上的八卦。',
    text: '金鹰四楼的奶茶店永远排长队。你们聊到手机没电，聊隔壁班的谁谁谁，也聊以后要去哪个城市。',
    effect: {
      knowledge: { all: -0.6 },
      money: -60,
      stats: { mood: 4.5, social: 5 },
      npc: { deskmate: 4 },
    },
  },
  {
    id: 'read',
    name: '看闲书',
    icon: '📚',
    tag: '娱乐',
    phase: 'both',
    desc: '读《三体》《百年孤独》，或者只是发呆写点东西。',
    text: '你把《三体》藏在英语书后面。罗辑在雪地里说"给岁月以文明"的时候，英语老师正在讲虚拟语气。',
    effect: {
      knowledge: { chinese: 1.5 },
      stats: { mood: 4, comprehensive: 3, fatigue: -2 },
    },
  },
  {
    id: 'write_novel',
    name: '写小说投稿',
    icon: '🖊️',
    tag: '娱乐',
    phase: 'weekend',
    cooldown: 2,
    desc: '把雨山湖边的故事写下来，投给杂志试试。',
    text: '你在晚自习后写了两千字，讲一个在马鞍山长大的少年。投出去的时候你把邮箱刷新了三次。',
    effect: {
      knowledge: { chinese: 2.2 },
      stats: { mood: 4, comprehensive: 3, fatigue: 2 },
      risk: [
        {
          chance: 0.3,
          text: '一个月后，杂志社回了邮件：录用了，稿费 200 元。你在教室里差点叫出来。',
          effect: { money: 200, stats: { mood: 8, comprehensive: 5 }, flags: { published: true } },
        },
      ],
    },
  },
  {
    id: 'vlog',
    name: '拍短视频',
    icon: '🎬',
    tag: '娱乐',
    phase: 'weekend',
    desc: '记录二中的日常，粉丝涨得比成绩快。',
    text: '你拍了雨山湖的日落、食堂的红烧肉和晚自习的灯。视频小火了一把，评论区全在问"这是哪个学校"。',
    effect: {
      knowledge: { all: -0.5 },
      stats: { mood: 4, social: 3, comprehensive: 3 },
      risk: [
        {
          chance: 0.3,
          text: '年级主任在家长群里看到了你的视频，要求你"马上删除"。',
          effect: { stats: { discipline: 5, teacherFavor: -4 }, npc: { head: -5 } },
        },
      ],
    },
  },
  {
    id: 'skip',
    name: '翘课去雨山湖',
    icon: '🛶',
    tag: '娱乐',
    phase: 'main',
    desc: '翻墙出去，在雨山湖边坐一个下午。',
    text: '你和两个同学翻过操场后面的矮墙，一路走到雨山湖。湖面亮得刺眼，谁也没提下午的数学课。',
    effect: {
      knowledge: { all: -2 },
      stats: { mood: 7, discipline: 9, fatigue: -3, social: 1.5 },
      risk: [
        {
          chance: 0.32,
          text: '回校时正好撞上出门办事的年级主任。三张通报批评贴在布告栏上，你的名字在中间。',
          effect: { stats: { discipline: 10, teacherFavor: -7, mood: -5 }, npc: { head: -8 } },
        },
      ],
    },
  },

  /* ------------------------------------------------------------ 关系 */
  {
    id: 'date',
    name: '谈恋爱',
    icon: '💌',
    tag: '关系',
    phase: 'weekend',
    cooldown: 2,
    desc: '认真经营一段高中恋爱，甜蜜也很分心。',
    text: '放学后你们绕远路走雨山湖边，谁也不提作业。晚自习的时候，你盯着练习册上的字，一个也没看进去。',
    effect: {
      money: -80,
      knowledge: { all: -1.1 },
      npc: { love: 12 },
      stats: { mood: 8, social: 3, discipline: 2 },
      flags: { earlyLove: true },
      risk: [
        {
          chance: 0.24,
          text: '班主任把你们俩叫到办公室，桌上摊着一张月考排名——你掉了 120 名。当晚家长的电话就打到了宿舍。',
          effect: { stats: { mood: -7, teacherFavor: -6, discipline: 4 }, flags: { loveExposed: true }, npc: { head: -8, parents: -8 } },
        },
      ],
    },
    requirement: (game) =>
      game.npc.love < 20 && game.stats.social < 45 ? '社交不足 45、也没有互相喜欢的人，暂时还没到那一步' : null,
  },
  {
    id: 'confess',
    name: '表白',
    icon: '💗',
    tag: '大事',
    phase: 'main',
    once: true,
    desc: '把憋了很久的话说出口（很可能被拒绝）。',
    text: '你在草稿纸上写了七遍又划掉七遍，最后在晚自习结束后叫住了对方。',
    effect: {
      stats: { mood: 2 },
    },
    requirement: (game) => (game.npc.love < 35 ? '好感还不到 35，现在表白大概率会尴尬' : null),
    special(game, api) {
      const power = (game.npc.love / 100) * 0.6 + (game.stats.social / 100) * 0.4;
      if (api.chance(0.35 + power * 0.75)) {
        game.flags.earlyLove = true;
        game.flags.confessed = true;
        api.addNpc('love', 22);
        api.addStat('mood', 12);
        api.addStat('social', 4);
        api.say('对方低着头说了句"嗯"。那一瞬间，雨山湖的风都变甜了。');
      } else {
        game.flags.rejected = true;
        api.addNpc('love', -8);
        api.addStat('mood', -10);
        api.say('"我们还是好好高考吧。"你笑着说好，回宿舍的路上把耳机音量开到了最大。');
      }
    },
  },
  {
    id: 'breakup',
    name: '分手专注学习',
    icon: '💔',
    tag: '大事',
    phase: 'main',
    desc: '结束这段关系，把心收回来（很疼，但专注了）。',
    text: '你们在雨山湖边的长椅上坐了很久，最后是你说的话。回学校的路上你一个人走得很慢。',
    effect: {
      stats: { mood: -12, fatigue: 2 },
      knowledge: { all: 2.4 },
      npc: { love: -40 },
      flags: { earlyLove: false, brokeUp: true },
    },
    requirement: (game) => (game.flags.earlyLove ? null : '你现在没有在谈恋爱'),
  },
  {
    id: 'club',
    name: '社团活动',
    icon: '🤖',
    tag: '特长',
    phase: 'both',
    desc: '模联、机器人社、合唱团——把简历写厚一点。',
    text: '机器人社的活动室在实验楼一楼，桌上摊着焊坏的电路板。你在模联拿到了"最佳阐述"，也在合唱团学会了换气。',
    effect: {
      knowledge: { all: -0.8 },
      stats: { comprehensive: 6, social: 3.5, mood: 1.8, fatigue: 2.5 },
    },
  },
  {
    id: 'volunteer',
    name: '志愿服务',
    icon: '🤝',
    tag: '特长',
    phase: 'weekend',
    desc: '去社区、图书馆或养老院做志愿者，攒综合素质材料。',
    text: '周末你去了社区图书馆整理书架，又陪养老院的爷爷下了一下午象棋。志愿时长记了两个小时，你的名字进了综合素质档案。',
    effect: {
      money: -20,
      stats: { comprehensive: 7, social: 3, mood: 2, teacherFavor: 2 },
    },
  },

  /* ------------------------------------------------------------ 大事与路线 */
  {
    id: 'run_class',
    name: '竞选班干部',
    icon: '🙋',
    tag: '大事',
    phase: 'main',
    once: true,
    desc: '站上讲台，争取一个为班级做事的位置。',
    text: '你准备了整整一页的竞选发言，上台时手心全是汗。',
    effect: { stats: { fatigue: 2 } },
    special(game, api) {
      const power = (game.stats.social / 100) * 0.7 + (game.stats.teacherFavor / 100) * 0.3;
      if (api.chance(0.25 + power * 0.8)) {
        game.flags.classLeader = true;
        api.addStat('teacherFavor', 8);
        api.addStat('social', 5);
        api.addStat('comprehensive', 5);
        api.addNpc('head', 8);
        api.say('你以第二高票当选学习委员。从这天起，你每天要收发作业、记考勤，也和所有老师都熟了。');
      } else {
        api.addStat('mood', -4);
        api.say('你落选了。回家的路上你在心里把发言稿又改了一遍。');
      }
    },
  },
  {
    id: 'reselect',
    name: '改选科',
    icon: '🔀',
    tag: '大事',
    phase: 'main',
    once: true,
    needsSubject: true,
    subjectPool: 'electives',
    desc: '换掉一门再选科目（高一上学期结束前只有一次机会）。',
    text: '你走进教务处的办公室，交上了那张改选申请表。新的科目要从头补起。',
    effect: { stats: { mood: -3, fatigue: 3 } },
    requirement: (game) => (game.semesterIndex === 0 ? null : '选科已经定了，只有高一上学期还能改'),
    special(game, api) {
      const newKey = api.subject;
      const electives = game.subjectKeys.filter((key) => ['chemistry', 'biology', 'politics', 'geography'].includes(key));
      const drop = electives.slice().sort((a, b) => (game.knowledge[a] ?? 0) - (game.knowledge[b] ?? 0))[0];
      if (!drop || drop === newKey) {
        api.say('教务处看了看你的申请表，说这次就不用改了。');
        return;
      }
      const kept = game.subjectKeys.filter((key) => key !== drop);
      const average = kept.reduce((sum, key) => sum + (game.knowledge[key] ?? 0), 0) / kept.length;
      game.subjectKeys = kept.concat(newKey);
      game.knowledge[newKey] = Math.round(average * 0.65 * 10) / 10;
      api.say(`你从${api.subjectNameOf(drop)}换到了${api.subjectNameOf(newKey)}，旧科目的基础只带过来了六成。班里的座位也换了。`);
    },
  },
  {
    id: 'art_class',
    name: '报名艺考班',
    icon: '🎨',
    tag: '大事',
    phase: 'main',
    once: true,
    desc: '白天上课、晚上画画，走艺考路线（花钱较多）。',
    text: '画室的松节油味呛得人眼睛发酸。老师说："想清楚，艺考不是捷径，是另一条更长的路。"',
    effect: {
      money: -300,
      knowledge: { all: -0.8 },
      stats: { comprehensive: 10, mood: 3, fatigue: 4 },
      flags: { artTrack: true },
    },
    requirement: (game) => (game.stats.comprehensive < 35 ? '综合素质不足 35，画室老师建议你先想清楚' : null),
  },
  {
    id: 'apply_qiangji',
    name: '报名强基计划',
    icon: '🧪',
    tag: '大事',
    phase: 'main',
    once: true,
    desc: '拿竞赛奖项或单科尖子成绩去申请基础学科。',
    text: '你在报名系统里填了三个专业：数学、物理、化学。提交那一刻手心有点汗。',
    effect: {
      stats: { comprehensive: 6 },
      flags: { qiangji: true },
    },
    requirement: (game) => {
      if (game.flags.contestProv1 || (game.flags.contestStage ?? 0) >= 3) return null;
      const best = Math.max(...game.subjectKeys.map((key) => game.knowledge[key] ?? 0));
      return best < 85 ? '需要竞赛省一等奖，或者某一科知识 ≥85' : null;
    },
  },
  {
    id: 'apply_zonghe',
    name: '报名综合评价',
    icon: '📋',
    tag: '大事',
    phase: 'main',
    once: true,
    desc: '用社团、志愿和荣誉材料去申请综合评价招生。',
    text: '你把三年的材料装进一个文件夹：模联证书、志愿时长、校合唱团的演出照片。厚厚一摞。',
    effect: {
      money: -50,
      stats: { comprehensive: 8, mood: 2 },
      flags: { zonghe: true },
    },
    requirement: (game) => (game.stats.comprehensive < 55 ? '综合素质不足 55，材料还不够看' : null),
  },
  {
    id: 'quit_school',
    name: '申请退学',
    icon: '🚪',
    tag: '大事',
    phase: 'main',
    once: true,
    desc: '不读了。这是你的自由，也是这一局的结局。',
    text: '你在教导处门口站了很久，最后敲了门。',
    effect: {},
    special(game, api) {
      api.endGame('dropped_out');
    },
  },
  {
    id: 'take_gaokao',
    name: '报名参加高考',
    icon: '🎓',
    tag: '大事',
    phase: 'main',
    desc: '自由模式专用：什么时候上考场，你自己说了算。',
    text: '你在报名表上签下自己的名字。剩下的日子，每一天都是你自己安排的。',
    effect: {},
    requirement: (game) => {
      if (!game.endless) return '普通模式下，高考会在高三下学期自动到来';
      if (game.semesterIndex < 4) return '才高一高二，报名高考还太早（高三才能报）';
      return null;
    },
    special(game, api) {
      api.takeGaokao();
    },
  },
];

export const ACTION_MAP = Object.fromEntries(ACTIONS.map((action) => [action.id, action]));
