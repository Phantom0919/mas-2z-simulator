/**
 * 第七批随机事件：**一周里的那些小事**（v3.3）。
 *
 * 前六批分别写了"离谱的事""校历上的大事""抽象结局""校园日常""因果链"，
 * 这一批补的是**重复度最高的那一层**：食堂、暖气、接力棒、改卷子、家长会、
 * 手机被没收、换座位、同学录。它们的共同点是——**每周都可能撞上，而且每次的选择都不太一样**。
 *
 * 写这一批的三条原则（和 events5 一致，故意的）：
 *   1. 每个 choice 事件三个选项：**一个稳但收益低、两个带代价或风险**，
 *      让"这周到底要不要花时间"真的纠结一下；
 *   2. "状态差才会出事"一律用 `risk` 表达（体质/心情/疲劳/违纪到某个线才给重惩罚），
 *      不写死成必然坏结果；
 *   3. 拿不准的后果写成函数 `(game) => ({...})`，让数值跟着这一局的实际状态走。
 *
 * 时间约束统一登记在 `src/data/calendar.js` 的 `EVENT_SCHEDULE` 里
 * （有测试强制要求"每个事件都必须登记"，忘了写会直接红）。
 * 自检：`node --test test/events7.test.js`。
 */

export const DAILY_EVENTS = [
  /* ---------------------------------------------------------- 食堂 */
  {
    id: 'canteen_new_window',
    name: '食堂新开的窗口',
    icon: '🍜',
    kind: 'choice',
    weight: 9,
    text:
      '二楼西头新开了一个窗口，红色的招牌上写着"现炒·八分钟"。队伍从窗口一直排到楼梯口，' +
      '旁边旧窗口的阿姨把勺子敲得梆梆响："那边有什么好吃的，都是预制菜。"',
    choices: [
      {
        id: 'queue_patiently',
        label: '老老实实排队',
        hint: '稳，但耗掉午休',
        outcome:
          '你排了二十五分钟，端回来的时候面已经有点坨。同桌扒了一口说"也就那样"，你却觉得值——这是这学期第一顿不是大锅菜的午饭。',
        effect: { stats: { mood: 4, fatigue: 1 }, knowledge: { all: -0.3 } },
      },
      {
        id: 'eat_old_window',
        label: '还是吃老窗口',
        hint: '省时间，阿姨记你人情',
        outcome: '你端着盘子坐到老窗口前面，阿姨多给了你一勺肉："学生仔，还是你懂。"',
        effect: { stats: { mood: 2, money: 0, fatigue: -1 }, npc: { parents: 1 }, knowledge: { all: 0.2 } },
      },
      {
        id: 'cut_the_line',
        label: '装作找同学，插到前面去',
        hint: '省时间，有人认得你',
        outcome: '你挤到第三排，装作在喊人。后面有人"啧"了一声，但没人拦你。面是真的好吃。',
        effect: (game) => ({
          stats: { mood: 5, social: -1 },
          flags: { canteenCutter: true },
          risk: [
            {
              // 心情低的时候脸皮薄，被人当面点出来会特别难受
              chance: game.stats.mood <= 40 ? 0.5 : 0.2,
              text: '',
              effect: {
                text:
                  '排在你后面的女生把你的名字喊了出来——是隔壁班的，上周还借过你的笔记。' +
                  '整个楼梯口都安静了两秒。你端着空盘子退到了队尾。',
                stats: { mood: -9, social: -4 },
                npc: { deskmate: -2 },
                flags: { canteenShamed: true },
              },
            },
          ],
        }),
      },
    ],
  },

  /* ------------------------------------------------------ 冬天的教室 */
  {
    id: 'winter_window_war',
    name: '教室的窗子',
    icon: '❄️',
    kind: 'choice',
    weight: 8,
    text:
      '十一月的教室，靠窗那一排冷得握不住笔，靠门那一排热得脱外套。' +
      '值日生要去开窗通风，前两排立刻有人按住窗把手："开一条缝就够了！"',
    choices: [
      {
        id: 'open_wide',
        label: '按学校要求，通风就通风',
        hint: '照规矩办，得罪人',
        outcome:
          '你把两扇窗都推开，冷风一下子灌进来。前两排响起一片"嘶"的声音，有人把校服蒙在了头上。' +
          '课间操回来，窗户被人悄悄关上了一半。',
        effect: { stats: { discipline: 2, social: -2, mood: -2 }, npc: { head: 2 } },
      },
      {
        id: 'half_open',
        label: '开一条缝，两边都不得罪',
        hint: '稳，没啥变化',
        outcome: '你把窗开到两指宽，冷热都各让一步。没人说话，也没人感谢你。这可能是最好的结果。',
        effect: { stats: { social: 1 } },
      },
      {
        id: 'swap_seats',
        label: '干脆和靠门的同学换一周座位',
        hint: '有人记你一辈子，也可能感冒',
        outcome:
          '你和靠门那位换了座位。他愣了半秒，说"你真换啊"，然后把书搬了过去，' +
          '第二天给你带了一包姜糖。',
        effect: (game) => ({
          stats: { mood: 4, social: 3, physique: -1 },
          npc: { deskmate: 3, friend: 4 },
          flags: { windowSwap: true },
          risk: [
            {
              // 体质差的时候吹一周冷风就是真感冒
              chance: game.stats.physique <= 45 ? 0.45 : 0.12,
              text: '',
              effect: {
                text:
                  '吹到第四天，你开始打喷嚏、喉咙发痒。医务室量了体温，三十七度八，' +
                  '班主任让你回家休息——这一周的课全落下了。',
                stats: { physique: -6, mood: -5, fatigue: 6 },
                knowledge: { all: -1.2 },
                flags: { winterCold: true },
              },
            },
          ],
        }),
      },
    ],
  },

  /* -------------------------------------------------------- 运动会 */
  {
    id: 'sports_meet_relay',
    name: '4×100 的第四棒',
    icon: '🏃',
    kind: 'choice',
    weight: 7,
    text:
      '秋季运动会报名截止前十分钟，班里的体育委员举着报名表冲过来：' +
      '"最后一棒没人，你跑不跑？跑不跑你说句话。"' +
      '你抬头看了一眼操场，第三棒的接力区那边已经有人在练交接了。',
    choices: [
      {
        id: 'take_anchor',
        label: '跑，跑最后一棒',
        hint: '班级荣誉 + 心情，看体质',
        outcome:
          '发令枪响的时候，你站在第四棒的位置上，手心全是汗。接力棒砸进你手心的那一下，' +
          '整条跑道都在响。你跑完冲过终点，成绩怎么样已经不重要了。',
        effect: (game) => ({
          stats: { mood: 8, physique: 2, fatigue: 4, social: 4 },
          npc: { friend: 6, head: 3 },
          flags: { relayAnchor: true },
          risk: [
            {
              // 体质不行硬上，最容易在最后 30 米出事
              chance: game.stats.physique <= 40 ? 0.4 : 0.1,
              text: '',
              effect: {
                text:
                  '最后三十米你大腿后侧"抽"地一下，整个人摔在了跑道上。观众席的声音一下子变远了。' +
                  '你被两个人架下场，脚踝肿了起来——接下来两周的体育课和你没关系了。',
                stats: { physique: -8, mood: -6, fatigue: 6 },
                flags: { relayInjury: true },
              },
            },
          ],
        }),
      },
      {
        id: 'be_substitute',
        label: '当替补，需要我再上',
        hint: '不占时间，也有存在感',
        outcome: '你在检录处坐了三个小时，递水、看包、替人看衣服。最后没轮到你上场，但合影的时候大家都喊你站中间。',
        effect: { stats: { mood: 3, social: 2 }, npc: { friend: 3 }, flags: { relaySubstitute: true } },
      },
      {
        id: 'study_instead',
        label: '不报，去教室做卷子',
        hint: '多学一点，错过热闹',
        outcome:
          '运动会那两天，教学楼安静得能听见自己翻书的声音。你做完了一整套理综卷，' +
          '傍晚下楼的时候，听见操场那边在喊班级口号。',
        effect: { stats: { mood: -3, fatigue: 1 }, knowledge: { all: 0.8 }, flags: { meetStudied: true } },
      },
    ],
  },

  /* ------------------------------------------------------ 帮老师改卷子 */
  {
    id: 'grader_helper',
    name: '办公室的卷子',
    icon: '📝',
    kind: 'choice',
    weight: 7,
    text:
      '课间你被数学老师叫到办公室。桌上摊着刚考完的卷子，红笔和答案纸都推到你面前：' +
      '"就改选择题，一节课。放心，你自己那张我先抽出来了。"' +
      '——但答題卡是按学号排的，你的学号就在第二叠第三张。',
    choices: [
      {
        id: 'grade_honest',
        label: '一题一题照着答案改',
        hint: '老师好感 + 综合素质 +',
        outcome:
          '你改了两百多道选择题，红笔用掉半支。老师的保温杯里添了两次水，' +
          '最后说了一句："下次还找你。"',
        effect: (game) => ({
          stats: { comprehensive: 3, teacherFavor: 4, fatigue: 2 },
          // 顺手对答案的过程本身就是复习；数学底子越好，这一节课的收获越大
          knowledge: game.knowledge.math >= 70 ? { math: 1.8 } : { math: 1.2 },
          npc: { math: 5 },
          flags: { graderTrusted: true },
        }),
      },
      {
        id: 'peek_own',
        label: '趁老师出去接水，翻一眼自己那张',
        hint: '知道分数，风险不小',
        outcome:
          '你飞快地翻到第二叠第三张，只看了一眼总分——比你想的高一点。' +
          '你把卷子放回去，手在裤子上擦了擦汗。那节课剩下的时间，你一道题都没改进去。',
        effect: (game) => ({
          stats: { mood: 2, fatigue: 2 },
          flags: { peekingScore: true },
          risk: [
            {
              // 心虚的人容易露馅：心情差 + 疲劳高更容易被看出来
              chance: game.stats.mood <= 45 || game.stats.fatigue >= 60 ? 0.45 : 0.15,
              text: '',
              effect: {
                text:
                  '老师端着杯子站在门口看了你三秒。她没发火，只是把卷子重新码了一遍，' +
                  '说："改卷子是让你看错在哪里，不是看分数。" 那三个字在办公室里来回撞。',
                stats: { mood: -10, teacherFavor: -6, comprehensive: 1 },
                npc: { math: -8, head: -3 },
                flags: { graderCaught: true },
              },
            },
          ],
        }),
      },
      {
        id: 'grade_sloppy',
        label: '随便划两笔，赶紧回教室',
        hint: '省时间，可能被返工',
        outcome: '你划得飞快，五十分钟改完了两百多张。回教室的路上，你隐约觉得自己好像改错了几张。',
        effect: (game) => ({
          stats: { fatigue: -2 },
          knowledge: { all: 0.2 },
          risk: [
            {
              chance: 0.3,
              text: '',
              effect: {
                text:
                  '第二天数学课上，老师念了三个"被改错分数"的学号，其中两个是你改的。' +
                  '她没说是谁改的，但你的耳朵一直烧到下课。',
                stats: { mood: -5, teacherFavor: -2 },
                npc: { math: -3 },
                flags: { graderSloppy: true },
              },
            },
          ],
        }),
      },
    ],
  },

  /* ---------------------------------------------------------- 换座位 */
  {
    id: 'seat_change_after_midterm',
    name: '期中之后的座位表',
    icon: '🪑',
    kind: 'choice',
    weight: 8,
    text:
      '期中考试一结束，班主任拿着座位表进来："这次按新规矩调——成绩互补，两个人一组。"' +
      '名单贴在讲台边上，你的名字后面还空着，谁跟你一组要看等下的抽签。',
    choices: [
      {
        id: 'pick_weak',
        label: '主动挑了班里成绩靠后的那个',
        hint: '故事最多，占时间',
        outcome:
          '你把名字写在了他旁边。他一节课都在低头转笔，下课才小声问："你为什么要跟我坐？"',
        effect: (game) => ({
          stats: { social: 4, comprehensive: 2, fatigue: 1 },
          npc: { friend: 5, deskmate: 4 },
          flags: { seatPickedWeak: true },
          // 讲题是最好的复习：自己底子越厚，收获越大
          knowledge: game.knowledge.math >= 60 ? { math: 0.8 } : { all: 0.3 },
        }),
      },
      {
        id: 'pick_rival',
        label: '挑老对手，天天面对面',
        hint: '成绩可能涨，心情掉得快',
        outcome:
          '你在他旁边坐下，他侧头看了你一眼，把桌上一半的草稿纸往自己那边挪了挪。' +
          '接下来这两周，你们谁都没先说话，但两个人的错题本都厚了一圈。',
        effect: {
          stats: { mood: -2, fatigue: 2, discipline: 1 },
          knowledge: { all: 0.9 },
          npc: { rival: 6 },
          flags: { seatWithRival: true },
        },
      },
      {
        id: 'let_teacher_decide',
        label: '随便，老师安排就好',
        hint: '稳，没什么波澜',
        outcome: '你被安排在中间第三排，同桌是个安静的女生，两个人一周说的话不超过十句。也挺好，安静。',
        effect: { stats: { mood: 1 }, knowledge: { all: 0.3 } },
      },
    ],
  },

  /* ------------------------------------------------------ 手机被没收 */
  {
    id: 'phone_confiscated',
    name: '手机被收进抽屉',
    icon: '📱',
    kind: 'choice',
    weight: 7,
    text:
      '晚自习你正低头回消息，德育处的老师从后门进来，手直接按在了你屏幕上。' +
      '"学校三令五申不让带手机。" 手机被装进一个牛皮纸信封，写上你的学号和班级，' +
      '"期末考完来拿。想早点拿，让家长来一趟。"',
    choices: [
      {
        id: 'accept_punishment',
        label: '认罚，期末再说',
        hint: '违纪 +，心情 -，但省事',
        outcome:
          '你在信封上签了名。接下来一个月，你每天晚上早睡了半小时——因为确实没事可干。',
        effect: { stats: { discipline: 5, mood: -5, fatigue: -3 }, flags: { phoneSeized: true } },
      },
      {
        id: 'ask_parents',
        label: '给家里打电话，让他们来一趟',
        hint: '家长好感，可能挨骂',
        outcome:
          '你妈第二天请了半天假来学校，在办公室门口站了十分钟。她没骂你，' +
          '只是把手机装进包里说："先放我这儿，考完给你。" 你看着她走下楼，背影比你以为的瘦。',
        effect: (game) => ({
          stats: { discipline: 3, mood: -3 },
          npc: { parents: game.npc.parents >= 70 ? 6 : 2 },
          flags: { phoneSeized: true, parentsCameSchool: true },
        }),
      },
      {
        id: 'write_review',
        label: '写一份三千字的检讨，争取早点拿回来',
        hint: '花时间换通畅，看文笔',
        outcome:
          '你写了一晚上检讨，从"自律"写到"对未来的责任"。班主任看完折了一下，' +
          '说"字比上次好"，把手机还给了你——附一句："下次直接来找我，别写这些虚的。"',
        effect: (game) => ({
          // 语文底子差的人写三千字更费劲：多花 2 点疲劳
          stats: { discipline: 2, fatigue: game.knowledge.chinese < 50 ? 5 : 3, mood: 2, teacherFavor: 2 },
          knowledge: { chinese: 0.9 },
          npc: { head: 4 },
          flags: { phoneSeized: true, reviewWriter: true },
        }),
      },
    ],
  },

  /* -------------------------------------------------------- 家长会 */
  {
    id: 'parents_meeting_eve',
    name: '家长会的前一晚',
    icon: '🏫',
    kind: 'choice',
    weight: 8,
    text:
      '通知单上写着明天晚上七点开家长会，请家长带笔。"成绩条会当场发。"' +
      '晚饭桌上，你爸把通知单翻来覆去看了两遍，什么也没问。',
    choices: [
      {
        id: 'tell_truth',
        label: '主动把这次的名次说了',
        hint: '家长好感，心里踏实',
        outcome:
          '你把名次和哪几科掉了都说了。你爸听完只是"哦"了一声，然后问："那你想怎么办？"' +
          '——这句话比骂你还难回答。',
        effect: (game) => ({
          stats: { mood: 4, comprehensive: 1 },
          npc: { parents: 7 },
          flags: { toldTruth: true },
        }),
      },
      {
        id: 'hide_bad',
        label: '只报了最好的那两科',
        hint: '稳住今晚，家长会有风险',
        outcome: '你把成绩条上最低的那两行折了过去。饭桌上气氛很好，你爸还给你夹了块排骨。',
        effect: (game) => ({
          stats: { mood: 3 },
          npc: { parents: 2 },
          flags: { hidScore: true },
          risk: [
            {
              // 纸包不住火：家长会当场发成绩条
              chance: 0.55,
              text: '',
              effect: {
                text:
                  '家长会上，班主任把成绩条一张张递到家长手里。你爸拿着那张纸看了很久，' +
                  '回家路上一句话没说。进门后他问："你昨天为什么不说？"',
                stats: { mood: -9 },
                npc: { parents: -8, head: -1 },
                flags: { hidScoreBusted: true },
              },
            },
          ],
        }),
      },
      {
        id: 'cook_together',
        label: '睡前陪他们做一顿宵夜',
        hint: '心情 +，占掉一小时',
        outcome:
          '你把冰箱里的饺子和剩菜热了，三个人在厨房里站着吃完。你妈说了三遍"早点睡"，' +
          '你爸全程在讲他厂里的事。这一小时没学一个字，但你睡得很沉。',
        effect: { stats: { mood: 6, fatigue: -4 }, npc: { parents: 5 }, flags: { midnightSnack: true } },
      },
    ],
  },

  /* -------------------------------------------------------- 同学录 */
  {
    id: 'class_album_sign',
    name: '传过来的同学录',
    icon: '📖',
    kind: 'choice',
    weight: 6,
    text:
      '高考前的最后一节自习课，一本硬壳的同学录从第一排传过来。' +
      '轮到你这页时，上面已经写满了别人的字：有的工整，有的潦草，' +
      '最下面一行是空白的"想对你说的话"。',
    choices: [
      {
        id: 'write_honest',
        label: '认真写，写给每一个传过来的人',
        hint: '占时间，但值得',
        outcome:
          '你写了十几页，手酸得握不住笔。写到最好的朋友那页时，你停了很久，' +
          '最后只写了"以后有事，随时找我"。',
        effect: { stats: { mood: 7, fatigue: 3, comprehensive: 2 }, npc: { friend: 5, deskmate: 4 }, flags: { classAlbumSigned: true } },
      },
      {
        id: 'write_short',
        label: '只写一句"高考加油"',
        hint: '省时间，大家都这么写',
        outcome: '你写了一句"高考加油"，签上名字，往后传。前后左右写的都是这五个字。',
        effect: { stats: { social: 1 }, knowledge: { all: 0.2 } },
      },
      {
        id: 'write_review',
        label: '不写同学录，去把最后一套题做完',
        hint: '多刷一套，错过一点什么',
        outcome:
          '你把同学录往前传，翻开卷子做了最后一套选择题。下课铃响的时候，' +
          '那本同学录已经传完了一圈，没有人再传回给你。',
        effect: { stats: { mood: -4 }, knowledge: { all: 0.9 }, flags: { skippedAlbum: true } },
      },
    ],
  },
];

/**
 * 这一批事件自带的成就（引擎按 flag 自动捡）。
 * 只挑"做到了某件不容易的事"的那几个 flag，不给每个选项都发奖。
 */
export const DAILY_ACHIEVEMENTS = [
  { flag: 'relayAnchor', icon: '🏃', name: '第四棒', desc: '运动会上跑了最后一棒' },
  { flag: 'graderTrusted', icon: '🧑‍🏫', name: '小老师', desc: '被老师叫去改过卷子' },
  { flag: 'classAlbumSigned', icon: '📖', name: '同学录', desc: '认真写完了传过来的同学录' },
  { flag: 'windowSwap', icon: '❄️', name: '靠窗的人', desc: '和同学换了整整一周的座位' },
];
