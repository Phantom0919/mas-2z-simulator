/**
 * 第六批事件：**因果链**——你这次的选择，会在几周之后长出后果。
 *
 * 前五批事件都是"这一周发生的事，这一周就结束"。这一批不一样：
 * 第一环落在随机池里，玩家做出选择后，effect 里挂一条
 * `chain: { id: '下一环的id', delay: 4 }`，引擎就会在 4 个回合（约两周）之后
 * **强制**把下一环弹出来。于是"借出去的东西""撒过的谎""湖边的约定"
 * 这些东西会一直吊在玩家头上，让世界显得记得他做过什么。
 *
 * 写这一批的约定（和 tools/check-events6.mjs 里的检查一一对应）：
 *   1. 第一环（进入随机池的那个）**不写** chainOnly；被链到的后续环
 *      一律写 `chainOnly: true`（不进随机池，只能被链出来），id 统一用 `chain_` 前缀，
 *      并且必须在 src/data/calendar.js 的 EVENT_SCHEDULE 里登记 `{ anytime: true }`。
 *   2. delay 是"回合"（1 回合 = 半周，一个主行动段），这一批统一取 3~6，
 *      也就是两三周到一学期，长了不像因果，短了像连播。
 *   3. 后续环要能**独立读懂**：文案里回指"上次那件事"，但绝不假设玩家记得自己选了什么，
 *      一律用第一环写下的 flag（lentNagged / lakePromiseVague / peekNoticed …）分两支写 text。
 *   4. 至少四个 ending 字段引用引擎真实存在的结局 id。这一批用到五个：
 *        chain_lend_item_aftermath → friendship（同桌好感 ≥65 才算数）
 *        chain_stranger_shop_offer → startup（六科平均分 ≤58，书念不下去了才接摊子）
 *        chain_secret_skill_debut  → vlog（综合素质 ≥58，作品才有人要）
 *        chain_club_recommendation → zonghe（综合素质 ≥70）
 *        chain_lake_promise_summer → love（恋爱线 ≥65）
 *      其中 zonghe 在引擎里是 specialEndingFor 现场拼出来的，不在 ENDINGS 表里，
 *      所以走 endingExtra 把标题/正文一并带上（否则 finish() 会退回"毕业"）。
 *
 * 自检：`node tools/check-events6.mjs`。时间表登记在 src/data/calendar.js。
 */

export const CHAIN_EVENTS = [
  /* ==================================================================== *
   *  链 ① 借出去的东西：lend_out_earphones
   *      → chain_lend_item_returned → chain_lend_item_aftermath
   * ==================================================================== */
  {
    id: 'lend_out_earphones',
    name: '借出去的那副耳机',
    icon: '🎧',
    kind: 'choice',
    weight: 10,
    text:
      '这副耳机是你攒了两个月零花钱买的，平时连盒子都舍不得压。晚自习前{deskmate}转过身来，' +
      '说要借去录一首歌，“就两天，我保证不摔”，说完把手伸在你面前。' +
      '教室后排的风扇转得很慢，你盯着那只手看了两秒。',
    choices: [
      {
        id: 'lend_it',
        label: '连着盒子一起递过去',
        hint: '大方，也可能肉疼',
        outcome: '你把耳机和盒子一起递过去，还顺手教了他怎么收线。他拍了拍你的肩，说了句“够意思”。',
        effect: {
          stats: { social: 3, mood: 4 },
          npc: { deskmate: 7 },
          flags: { lentItem: true, lentFriendly: true },
          chain: { id: 'chain_lend_item_returned', delay: 4 },
        },
      },
      {
        id: 'lend_with_words',
        label: '借，但叮嘱了三遍',
        hint: '他嘴上答应，心里记着',
        outcome: '你把耳机递过去，又补了三句“别压别摔别进水”。他“嗯嗯嗯”地应着，把盒子塞进书包侧兜。',
        effect: {
          stats: { mood: -2, social: 2 },
          npc: { deskmate: 3 },
          flags: { lentItem: true, lentNagged: true },
          chain: { id: 'chain_lend_item_returned', delay: 4 },
        },
      },
      {
        id: 'keep_it',
        label: '说自己也天天要用',
        hint: '稳，他记住了这句',
        outcome: '你把耳机往抽屉里一塞，说“我就这一副”。他“哦”了一声转回去，那一节课没再跟你说话。',
        effect: { stats: { mood: -3 }, npc: { deskmate: -6 }, flags: { lentRefused: true } },
      },
    ],
  },
  {
    id: 'chain_lend_item_returned',
    name: '还回来的那副耳机',
    icon: '🎧',
    kind: 'choice',
    chainOnly: true,
    weight: 9,
    text: (game) =>
      game.flags.lentNagged
        ? '两个星期后他把耳机还回来。盒子擦得很干净，线也收得整整齐齐，他放在你桌上说了句“没弄坏”，' +
          '就回座位了，一整天没再提这事。你打开盒子，耳机表面一点灰都没有，反而比借出去那天还新。'
        : '两个星期后他把耳机还回来。你打开盒子，右边耳罩上多了一道浅划痕，线缠成一团，' +
          '像是被塞在书包最底下压了很久。他站在旁边看着你的手，脚尖在地上蹭了两下，没先开口。',
    choices: [
      {
        id: 'let_it_go',
        label: '笑笑说没事',
        hint: '心里记下这道痕',
        outcome: '你把耳机收进抽屉，说“能听就行”。他想说什么，最后只是把你的水杯往你那边推了推。',
        effect: {
          stats: { mood: -3, social: 2 },
          npc: { deskmate: 6 },
          flags: { lendLetGo: true },
          chain: { id: 'chain_lend_item_aftermath', delay: 5 },
        },
      },
      {
        id: 'ask_him_fix',
        label: '问他能不能一起修',
        hint: '要钱，也伤面子',
        outcome: '你把盒子转过去给他看那道划痕。他愣了一下，第二天塞给你五十块，你不要，他硬塞。',
        effect: {
          money: 50,
          stats: { mood: -4, social: -2 },
          npc: { deskmate: -3 },
          flags: { lendAskedFix: true },
          chain: { id: 'chain_lend_item_aftermath', delay: 5 },
        },
      },
      {
        id: 'buy_another',
        label: '算了，自己再买一副',
        hint: '花钱买清静',
        outcome: '你周末又去了一趟商场，用下半个月的饭钱买了同款。旧的那副被塞进抽屉最里面，再也没拿出来过。',
        effect: { money: -180, stats: { mood: -6, fatigue: 2 }, flags: { lendBoughtNew: true } },
      },
    ],
  },
  {
    id: 'chain_lend_item_aftermath',
    name: '毕业前的那顿饭',
    icon: '🤝',
    kind: 'choice',
    chainOnly: true,
    weight: 9,
    text: (game) =>
      game.flags.lendAskedFix
        ? '高三最后一个月的周末，{deskmate}把那五十块钱又塞回你手里，说“那事我记了三年”。' +
          '他说要请你吃顿烧烤，就当还那副耳机。你看着那张皱了的钱，手停在半空，没有接下。'
        : '高三最后一个月的周末，{deskmate}在食堂跟你说：“毕业前我请你吃顿烧烤吧，就当还那副耳机。”' +
          '他说这话的时候在笑，你却忽然想起那道浅浅的划痕，还有那天他脚尖蹭地的样子。',
    choices: [
      {
        id: 'same_city',
        label: '跟他报同一座城',
        hint: '要三年攒下的交情',
        outcome: (game) =>
          game.npc.deskmate >= 80
            ? '你们把志愿表摊在烧烤摊上，就着油渍把同一座城市圈了出来。他说“以后周末还能一起吃饭”，你说好。'
            : '你说“要不报同一座城”。他把签子放下，说“我这分够不着你想去的地方”。那天晚上你们谁也没再提。',
        effect: (game) =>
          game.npc.deskmate >= 80
            ? {
                stats: { mood: 12, social: 5 },
                npc: { deskmate: 8 },
                money: -60,
                flags: { lendItemFriend: true },
                // 毕业去向：不在这一周就把一局掐断，等高考结束时再结算（见 engine 的 finishGaokao）
                graduationEnding: 'friendship',
              }
            : {
                stats: { mood: 5, social: 2 },
                npc: { deskmate: 5 },
                money: -60,
                flags: { lendItemFriend: true },
              },
      },
      {
        id: 'treat_him_back',
        label: '这顿我来请',
        hint: '花钱，把账了了',
        outcome: '你抢着把钱付了。他说“那耳机的事就算了吧”，你说“早算了”。回去的路上你们并排推着车走。',
        effect: { money: -68, stats: { mood: 8, social: 4 }, npc: { deskmate: 8 }, flags: { lendItemFriend: true } },
      },
      {
        id: 'end_it',
        label: '说清楚，此后再不互借',
        hint: '干脆，也把人推远',
        outcome: '{deskmate}听完笑了笑，说“行”。烧烤还是吃了，但从那以后你们没再借过对方任何东西，' +
          '连圆规都各买了一把。',
        effect: { stats: { mood: -6, social: -3 }, npc: { deskmate: -10 }, flags: { lendItemClosed: true } },
      },
    ],
  },

  /* ==================================================================== *
   *  链 ② 一次撒谎：forged_parent_signature → chain_signature_check
   * ==================================================================== */
  {
    id: 'forged_parent_signature',
    name: '签字栏上的笔迹',
    icon: '✍️',
    kind: 'choice',
    weight: 10,
    text:
      '月考卷子发下来，分数那栏被红笔圈了两圈，底下是空着的家长签字。你妈今晚加班到十点，' +
      '你的台灯正照着你爸以前签过的那个名字。笔尖在纸上停了一会儿，厨房里传来水开的声音。',
    choices: [
      {
        id: 'forge_it',
        label: '照着笔迹自己描',
        hint: '省一场谈话，风险在后',
        outcome: '你描了三遍才描得像，手心全是汗。第二天交卷子的时候，你把签字那页压在了最下面。',
        effect: (game) => ({
          stats: { mood: 3, fatigue: 1 },
          flags: { forgedSignature: true },
          chain: { id: 'chain_signature_check', delay: 5 },
          risk: [
            {
              chance: 0.3,
              text: '',
              effect: {
                text:
                  '你描的时候{deskmate}正好回头借橡皮，视线在签字栏上停了一下。他什么也没说，' +
                  '但你俩都知道对方看见了什么——这件事成了你们之间一个没人提的把柄。',
                stats: { mood: -5, social: -1 },
                npc: { deskmate: -3 },
                flags: { forgeryWitnessed: true },
              },
            },
          ],
        }),
      },
      {
        id: 'wait_tell',
        label: '等妈妈回来照实说',
        hint: '难看，但心里干净',
        outcome: '你等到十点半。你妈连外套都没脱就看完了卷子，说“这分数我不生气，你藏我才生气”。',
        effect: {
          stats: { mood: -5, comprehensive: 2 },
          npc: { parents: 7 },
          knowledge: { weakest: 1.2, count: 1 },
          flags: { signatureHonest: true },
        },
      },
      {
        id: 'ask_teacher',
        label: '第二天跟老师说晚交两天',
        hint: '老师会把这事记住',
        outcome: '你早读前去办公室说了。{head}看了你两秒，把卷子放回你手里：“后天早上，别忘了。”',
        effect: {
          stats: { mood: -2, discipline: -3 },
          npc: { head: 4 },
          flags: { signatureDeferred: true },
          chain: { id: 'chain_signature_check', delay: 5 },
        },
      },
    ],
  },
  {
    id: 'chain_signature_check',
    name: '签字栏被翻出来了',
    icon: '📄',
    kind: 'choice',
    chainOnly: true,
    weight: 9,
    text: (game) =>
      game.flags.forgedSignature
        ? '家长会那天，{head}把一摞卷子摊在讲台上，一页一页翻给家长看。翻到你那张时她停了一下——' +
          '签字栏上的字比别的家长年轻，还带着一遍描过的影子。你妈正低头看手机，没有抬头。'
        : '你在办公室补交了卷子。{head}把签字那页对着窗户的光看了几秒，什么也没说，' +
          '只是把卷子夹进了“待核实”那一叠，又抬眼看了你一下。',
    choices: [
      {
        id: 'confess',
        label: '当场承认是自己签的',
        hint: '难看，但只难堪一次',
        outcome: '你说“是我自己签的”。{head}沉默了一会儿，说“下次考砸了也可以来找我”。回家路上你妈才开口。',
        effect: {
          stats: { mood: -8, discipline: -8, comprehensive: 2 },
          npc: { head: 8, parents: -4 },
          flags: { confessedForgery: true },
        },
      },
      {
        id: 'keep_lying',
        label: '咬死说是妈妈签的',
        hint: '一旦被查，代价很大',
        outcome: '你说你妈那天签了，可能是笔换了、手抖了。{head}点点头，把卷子收了回去，没再追问。',
        effect: (game) => ({
          stats: { mood: -3 },
          flags: { forgeryDenied: true },
          risk: [
            {
              chance: game.stats.mood <= 45 || game.npc.head <= 45 ? 0.6 : 0.3,
              text: '',
              effect: (inner) =>
                inner.npc.head <= 35 || inner.stats.mood <= 32
                  ? {
                      text:
                        '你妈在家长群里看到了卷子的照片。她当着办公室几个老师的面说“这个字不是我签的”，' +
                        '声音不大，但整层楼都安静了。那天晚上你爸把手机放在桌上，让你自己解释。' +
                        '之后整整一个月，你妈看你的眼神都像在核对一份材料。',
                      stats: { mood: -22, discipline: 26, comprehensive: -3 },
                      npc: { parents: -20, head: -25 },
                      flags: { lieExposed: true },
                    }
                  : {
                      text:
                        '{head}没再问，但把那张卷子单独收进了抽屉。之后每次要家长签字，她都多看你一眼，' +
                        '让你把卷子当面举起来。你每次举起来的时候，都觉得那半行描过的字还在。',
                      stats: { mood: -8, discipline: 8 },
                      npc: { head: -8, parents: -5 },
                      flags: { lieExposed: true },
                    },
            },
          ],
        }),
      },
      {
        id: 'tell_parents_first',
        label: '先回家跟妈妈坦白',
        hint: '先挨一顿，再一起面对',
        outcome: '你把卷子递给你妈，把描签名的事从头说了。她气得把卷子拍在桌上，第二天还是跟你去了学校。',
        effect: {
          stats: { mood: -6, comprehensive: 1 },
          npc: { parents: 9, head: 3 },
          flags: { confessedForgery: true, parentsCovered: true },
        },
      },
    ],
  },

  /* ==================================================================== *
   *  链 ③ 帮过的陌生人：help_old_man_market
   *      → chain_stranger_find_school → chain_stranger_shop_offer
   * ==================================================================== */
  {
    id: 'help_old_man_market',
    name: '老市里的三轮车',
    icon: '🛒',
    kind: 'choice',
    weight: 10,
    text:
      '放学绕去老市里买菜，菜市场门口一辆三轮车歪在坡上，链条掉了，车斗里一筐青菜歪向一边。' +
      '推车的老爷子手上全是黑油，抬头看了你一眼，又低头去捣鼓那根链子。' +
      '天已经擦黑，摊主们开始收棚子，铁架子碰得哐当响。',
    choices: [
      {
        id: 'fix_chain',
        label: '蹲下去帮他装链条',
        hint: '费手费衣服，天更黑',
        outcome: '你蹲在马路牙子上装了十几分钟，指甲缝里全是黑油，链条终于挂上了。老爷子连说了三声“好孩子”。',
        effect: {
          stats: { fatigue: 5, mood: 6, physique: 1, social: 2 },
          flags: { helpedStranger: true },
          chain: { id: 'chain_stranger_find_school', delay: 6 },
        },
      },
      {
        id: 'push_to_shop',
        label: '帮着推到修车铺',
        hint: '多走一段路',
        outcome: '你俩一前一后把车推到街尾的修车铺，老板收了五块钱。老爷子非要塞给你两个橘子，你拿着走了。',
        effect: {
          stats: { fatigue: 7, mood: 4, social: 1 },
          flags: { helpedStranger: true, strangerOrange: true },
          chain: { id: 'chain_stranger_find_school', delay: 6 },
        },
      },
      {
        id: 'hurry_home',
        label: '看一眼，快步走开',
        hint: '稳，晚饭不凉',
        outcome: '你绕开那辆车走了。回家路上你一直想着那筐青菜，饭吃到一半忽然没什么胃口。',
        effect: { stats: { mood: -4, comprehensive: 1 }, flags: { strangerIgnored: true } },
      },
    ],
  },
  {
    id: 'chain_stranger_find_school',
    name: '找上门来的那筐橘子',
    icon: '🍊',
    kind: 'choice',
    chainOnly: true,
    weight: 9,
    text: (game) =>
      game.flags.strangerOrange
        ? '门卫在课间喊你的名字，说门口有个老爷子找。他推着那辆三轮车，车斗里放着一筐橘子，' +
          '一见你就站直了：“上次帮我推车的是你吧？这是自家树上摘的。”'
        : '门卫在课间喊你的名字，说门口有个老爷子找。他手里拎着一个塑料袋，里面是自家腌的咸菜，' +
          '见了你就问：“那天蹲在地上帮我装链条的，是不是你？”',
    choices: [
      {
        id: 'accept_visit',
        label: '收下，还去他店里坐坐',
        hint: '认下一段意外的交情',
        outcome: '他的小门面在健康路尽头，卖干货和自家腌的东西。他给你倒了一杯热水，讲了一下午他年轻时在马钢的事。',
        effect: {
          money: 20,
          stats: { mood: 9, social: 3, comprehensive: 2 },
          npc: { parents: 2 },
          flags: { strangerBond: true },
          chain: { id: 'chain_stranger_shop_offer', delay: 5 },
        },
      },
      {
        id: 'accept_share',
        label: '收下，拎回班里分掉',
        hint: '全班都沾了光',
        outcome: '你把橘子拎回教室放在讲台上，写上“随便拿”。晚自习前那筐就见了底，{deskmate}问你是哪个亲戚送的。',
        effect: {
          stats: { mood: 7, social: 6 },
          npc: { deskmate: 5, friend: 4 },
          flags: { strangerBond: true, strangerShared: true },
          chain: { id: 'chain_stranger_shop_offer', delay: 5 },
        },
      },
      {
        id: 'decline_thanks',
        label: '说不用，转身就走',
        hint: '干净，也断一条线',
        outcome: '你摆摆手说“举手之劳”，没留名字就回了教室。老爷子在门口站了一会儿，推着车走了。',
        effect: { stats: { mood: 3, comprehensive: 1 }, flags: { strangerDeclined: true } },
      },
    ],
  },
  {
    id: 'chain_stranger_shop_offer',
    name: '暑假的那个摊位',
    icon: '🏪',
    kind: 'choice',
    chainOnly: true,
    weight: 9,
    text: (game) =>
      game.flags.strangerShared
        ? '高考完第三天，老爷子托人带话，让你去健康路一趟。他说那间小门面想盘出去，“你们班那帮孩子' +
          '都爱吃我腌的东西，你要是愿意，就接着干”。柜台上放着一本写满数字的旧账本。'
        : '高考完第三天，老爷子在你家楼下等你。他说自己年纪大了，那间小门面想盘出去，' +
          '“你要是不打算念了，就来跟我干，本钱我先垫”。他说这话的时候一直看着你的鞋。',
    choices: [
      {
        id: 'join_him',
        label: '接下摊子，先干一个暑假',
        hint: '分不够的话是条路',
        outcome: (game) => {
          const keys = game.subjectKeys ?? [];
          const average = keys.length
            ? keys.reduce((sum, key) => sum + (game.knowledge[key] ?? 0), 0) / keys.length
            : 100;
          return average <= 58
            ? '你在那间门面里站了一个暑假，学会了称重、跟供货的人砍价，也学会了早上五点起床。开学通知书下来那天，你把它压在了抽屉里。'
            : '你在那间门面里站了一个暑假，学会了称重、跟供货的人砍价，也学会了早上五点起床。开学前你把账本记得清清楚楚，钥匙还了回去。';
        },
        effect: (game) => {
          const keys = game.subjectKeys ?? [];
          const average = keys.length
            ? keys.reduce((sum, key) => sum + (game.knowledge[key] ?? 0), 0) / keys.length
            : 100;
          const base = {
            money: 420,
            stats: { mood: 8, social: 5, fatigue: 6, comprehensive: 2 },
            flags: { summerStall: true, strangerPartner: true },
          };
          if (average <= 58) {
            return {
              ...base,
              money: 900,
              text:
                '店里的第二个月就开始排队，老爷子把最好的那口酱缸交给了你，说“你比我强”。' +
                '你在门口挂了一块新牌子，上面写着店名，底下是你的名字。',
              graduationEnding: 'startup',
            };
          }
          return {
            ...base,
            text: '老爷子说你天生会招呼人，让你以后放假常来。账本上那个暑假的进项，你记得比期末分数还清楚。',
          };
        },
      },
      {
        id: 'study_first',
        label: '先去读书，暑假再说',
        hint: '稳，机会会走掉',
        outcome: '你说“我得先去上学”。他点点头，从柜台上拿了包腌萝卜塞给你，说“以后想吃就来”。',
        effect: {
          stats: { mood: 6, comprehensive: 2 },
          npc: { parents: 5 },
          knowledge: { weakest: 1.6, count: 1 },
          flags: { strangerKept: true },
        },
      },
      {
        id: 'ask_wage',
        label: '不做老板，先打工拿钱',
        hint: '挣现钱，学不到手艺',
        outcome: '你说“我先帮您干活，按天算钱”。他笑着答应了，一天给你八十，还管一顿午饭。',
        effect: {
          money: 480,
          stats: { fatigue: 8, mood: 3, social: 2 },
          flags: { strangerSummerJob: true },
        },
      },
    ],
  },

  /* ==================================================================== *
   *  链 ④ 偷偷练的技能：secret_skill_nights → chain_secret_skill_debut
   * ==================================================================== */
  {
    id: 'secret_skill_nights',
    name: '被窝里的那点光',
    icon: '🎬',
    kind: 'choice',
    weight: 11,
    text:
      '熄灯之后，你把被子撑成一个小帐篷，手机屏幕调到最暗。教程里的老师正在讲怎么剪一个三秒的转场，' +
      '你把手指贴在屏幕上，跟着一遍一遍地暂停、回放。室友的呼吸声已经很匀，值周老师的脚步在走廊尽头响过一次。',
    choices: [
      {
        id: 'keep_night',
        label: '继续这样偷偷练下去',
        hint: '很爽，白天会困',
        outcome: '你连着练了三个星期，手机相册里全是废片。白天上课你掐着大腿，晚上一沾枕头就来精神。',
        effect: {
          stats: { mood: 7, fatigue: 8, comprehensive: 3 },
          flags: { secretSkill: true },
          chain: { id: 'chain_secret_skill_debut', delay: 5 },
        },
      },
      {
        id: 'practice_daylight',
        label: '改成白天光明正大地练',
        hint: '慢，但不用躲人',
        outcome: '你开始在课间和周末练。剪得没那么快，但不用再听走廊的脚步声，有人问你就说“剪着玩”。',
        effect: {
          stats: { mood: 5, comprehensive: 5, social: 2 },
          flags: { secretSkill: true, secretSkillOpen: true },
          chain: { id: 'chain_secret_skill_debut', delay: 5 },
        },
      },
      {
        id: 'put_away',
        label: '把教程删了，好好睡觉',
        hint: '稳，多年后会想起',
        outcome: '你把收藏夹清空，手机扣在枕头下。第二天早读你精神很好，只是在走廊看见别人举着手机拍东西时多看了两眼。',
        effect: { stats: { mood: -4, fatigue: -8 }, knowledge: { all: 0.5 }, flags: { skillDropped: true } },
      },
    ],
  },
  {
    id: 'chain_secret_skill_debut',
    name: '第一次被人看见',
    icon: '🎤',
    kind: 'choice',
    chainOnly: true,
    weight: 9,
    text: (game) =>
      game.flags.secretSkillOpen
        ? '艺术节的节目单上多了一个陌生的名字，你走近才发现是自己的。{deskmate}在旁边笑得很大声：' +
          '“报都替你报了，你就上吧。”节目单是手写的，你的名字那行墨还没干。'
        : '室友半夜录了你练手的那段视频，第二天早读前发到了班群里。半个班的人围着你的桌子问' +
          '“那个真是你剪的？”，你手机的电量还在往下掉。',
    choices: [
      {
        id: 'publish',
        label: '干脆自己发到网上',
        hint: '要胆子，也可能挨骂',
        outcome: (game) =>
          game.stats.comprehensive >= 58
            ? '你把攒了三个月的东西剪成两分钟发了出去。第二天醒来播放量比你想象的多了一个零，评论区有人说“二中我熟”。'
            : '你把攒了三个月的东西剪成两分钟发了出去。播放量停在两位数，你盯着那个数字看了半天，把手机翻了过去。',
        effect: (game) => {
          const base = {
            stats: { mood: 10, social: 5, comprehensive: 6 },
            money: 60,
            flags: { publishedWork: true },
          };
          if (game.stats.comprehensive >= 58) {
            return {
              ...base,
              text:
                '一条私信躺在你的后台，是本地一个做纪录片的人：“你镜头里的走廊让我想起自己高中。' +
                '要不要来我们这儿学传媒？”',
              graduationEnding: 'vlog',
            };
          }
          return {
            ...base,
            risk: [
              {
                chance: 0.3,
                text: '',
                effect: {
                  text:
                    '有人把你视频里的截图发到了年级群，配了一句“就这也敢发”。你把评论区关了两天，' +
                    '再打开的时候，发现有个陌生人给你留了一句“继续拍”。',
                  stats: { mood: -8, social: -3 },
                  flags: { onlineMocked: true },
                },
              },
            ],
          };
        },
      },
      {
        id: 'hide_it',
        label: '把视频删掉，装作没事',
        hint: '稳，会后悔一阵',
        outcome: '你当着室友的面删了原片，说“瞎剪的”。晚上你躺在床上，把那个界面在脑子里过了一遍又一遍。',
        effect: { stats: { mood: -7, comprehensive: 2 }, npc: { deskmate: -3 }, flags: { hidTalent: true } },
      },
      {
        id: 'class_show',
        label: '只在班里放一次',
        hint: '安全的小场面',
        outcome: '你在班会最后放了那段视频，教室里的灯关着。放到一半有人吹了声口哨，你听见{friend}在后面说了句“牛”。',
        effect: {
          stats: { mood: 8, social: 6, comprehensive: 3 },
          npc: { deskmate: 5, friend: 5 },
          flags: { classPerformance: true },
        },
      },
    ],
  },

  /* ==================================================================== *
   *  链 ⑤ 和爸妈的一次争吵：quarrel_parents_phone
   *      → chain_parents_cold_home → chain_parents_choice_night
   * ==================================================================== */
  {
    id: 'quarrel_parents_phone',
    name: '摔上的那扇门',
    icon: '🚪',
    kind: 'choice',
    weight: 12,
    text:
      '你妈在你书包夹层里翻出了手机，屏幕上还停在凌晨一点半的聊天界面。她把它放在饭桌上，' +
      '你爸从厨房探出头，说了句“又是他”。汤还在冒热气，你听见自己心跳的声音，' +
      '也听见筷子在碗沿上轻轻磕了一下。',
    choices: [
      {
        id: 'slam_door',
        label: '抢过手机，摔门进屋',
        hint: '一时痛快，冷战开始',
        outcome: '门“砰”的一声。你背靠着门坐在地上，听见外面碗筷碰了一下，然后是很长的安静。',
        effect: {
          stats: { mood: -5, fatigue: 2 },
          npc: { parents: -8 },
          flags: { slammedDoor: true, homeRow: true },
          chain: { id: 'chain_parents_cold_home', delay: 3 },
        },
      },
      {
        id: 'harsh_words',
        label: '顶回去，说最难听的那句',
        hint: '说出去就收不回',
        outcome: '你说“你们只看得见分数”。你妈的手停在半空，你爸把碗往桌上一放，那声闷响比骂你一顿还难受。',
        effect: (game) => ({
          stats: { mood: 3, fatigue: 2 },
          npc: { parents: -13 },
          flags: { harshWords: true, homeRow: true },
          chain: { id: 'chain_parents_cold_home', delay: 3 },
          risk: [
            {
              chance: 0.35,
              text: '',
              effect: {
                text:
                  '你妈没再说话，转身进了房间。你听见门锁轻轻响了一下，那声音在你耳朵里待了很久，' +
                  '洗碗的声音也没有再响起来。',
                stats: { mood: -12 },
                npc: { parents: -6 },
                flags: { momCried: true },
              },
            },
          ],
        }),
      },
      {
        id: 'swallow_apologize',
        label: '忍下来，饭后去道歉',
        hint: '稳，要在心里咽一口',
        outcome: '你把话咽了回去，吃完饭端着碗去厨房，说“我以后十一点前关手机”。你妈“嗯”了一声，把水果推到你面前。',
        effect: {
          stats: { mood: -4, comprehensive: 2 },
          npc: { parents: 8 },
          flags: { apologizedHome: true },
        },
      },
    ],
  },
  {
    id: 'chain_parents_cold_home',
    name: '冷战的那一周',
    icon: '🍚',
    kind: 'choice',
    chainOnly: true,
    weight: 10,
    text: (game) =>
      game.flags.momCried
        ? '接下来一个星期，家里静得能听见钟摆。你妈照常做饭、照常洗你的校服，只是不再问你任何事。' +
          '她的房门从那天起留了一条缝，里面的灯总是很晚才灭，你路过时能听见很轻的翻身声。'
        : '接下来一个星期，饭桌上只剩筷子碰碗的声音。你爸每天早上六点二十出门，把早饭放在桌上，' +
          '一句话不说。你出门时看见他那双鞋还摆在门口，鞋底磨得一边高一边低。',
    choices: [
      {
        id: 'break_ice',
        label: '端碗去厨房，先开口',
        hint: '低头一次，换一个家',
        outcome: '你在厨房门口站了一会儿，说了句“妈，我来洗碗”。她没回头，但把水龙头往你那边挪了挪。',
        effect: {
          stats: { mood: 8, fatigue: -3, comprehensive: 2 },
          npc: { parents: 10 },
          flags: { brokeIce: true },
          chain: { id: 'chain_parents_choice_night', delay: 4 },
        },
      },
      {
        id: 'stay_silent',
        label: '继续僵着，谁先说话谁输',
        hint: '面子赢了，家更冷',
        outcome: '你照样吃饭、照样上学，就是不说话。第二个星期你发现校服袖口开了线，一直没人给你补。',
        effect: {
          stats: { mood: -9, comprehensive: -1 },
          npc: { parents: -8 },
          knowledge: { all: 0.4 },
          flags: { homeColdWar: true },
          chain: { id: 'chain_parents_choice_night', delay: 4 },
        },
      },
      {
        id: 'run_away_night',
        label: '半夜出门走一圈',
        hint: '情绪上头，体质差出事',
        outcome: '十一点半你套上外套出了门。冷风一吹你就后悔了，但楼梯已经下到一半，你还是走了出去。',
        effect: (game) => ({
          stats: { mood: 4, fatigue: 6 },
          npc: { parents: -4 },
          flags: { ranAwayNight: true },
          chain: { id: 'chain_parents_choice_night', delay: 4 },
          risk: [
            {
              chance: game.stats.physique <= 45 || game.stats.mood <= 40 ? 0.5 : 0.2,
              text: '',
              effect: (inner) =>
                inner.stats.physique <= 34
                  ? {
                      text:
                        '你在雨山湖边的长椅上坐到凌晨三点，风从湖面上一直吹过来。第二天你烧到三十八度五，' +
                        '你妈一边给你换毛巾一边掉眼泪，你爸骑车把附近的公园和网吧找了个遍。',
                      stats: { physique: -18, mood: -10, fatigue: 12 },
                      npc: { parents: 6 },
                      flags: { ranAwaySick: true },
                    }
                  : {
                      text:
                        '你绕着小区的路灯走了三圈，最后在楼道口坐到十二点半。回家时门没锁，' +
                        '桌上的饭菜用碗扣着，摸上去还是温的。',
                      stats: { mood: -6, fatigue: 4 },
                      npc: { parents: 3 },
                    },
            },
          ],
        }),
      },
    ],
  },
  {
    id: 'chain_parents_choice_night',
    name: '他们最后说的那句话',
    icon: '🕯️',
    kind: 'choice',
    chainOnly: true,
    weight: 10,
    text: (game) =>
      game.flags.brokeIce
        ? '那天晚上你妈坐在客厅，把你三年前的照片翻给你看。她说：“我们不是要你考多好，' +
          '我们是怕你以后怪我们没管你。”电视开着，谁也没在看，屏幕的光在她脸上跳。'
        : '那天晚上家里只剩你一个人还醒着。你路过他们房间，听见你爸说“别管了，他自己有数”，' +
          '你妈回了一句“他才十七”。你站在门口，手放在门把上，最后没有推。',
    choices: [
      {
        id: 'ask_their_dream',
        label: '问他们当年想干什么',
        hint: '第一次把他们当人看',
        outcome: '你妈说她当年想当护士，你爸说他差点去当了兵。说到一半他们自己都笑了，那天晚上你们聊到十二点。',
        effect: {
          money: 300,
          stats: { mood: 12, comprehensive: 4, fatigue: 2 },
          npc: { parents: 15 },
          flags: { understoodParents: true },
        },
      },
      {
        id: 'make_deal',
        label: '谈个条件：给我一年',
        hint: '要承诺，也要兑现',
        outcome: '你把计划写在纸上：几点睡、周几碰手机、名次要回到哪一档。你爸看完签了名，像签一份合同。',
        effect: {
          stats: { mood: 7, comprehensive: 3, fatigue: 4 },
          npc: { parents: 9 },
          knowledge: { weakest: 2, count: 2 },
          flags: { familyDeal: true },
        },
      },
      {
        id: 'shut_again',
        label: '什么也没说，回房间',
        hint: '安全，门就一直关着',
        outcome: '你轻轻回了房间，把门带上。躺下之后你睁着眼看了很久的天花板，第二天照常起床、照常出门。',
        effect: { stats: { mood: -11, fatigue: 3 }, npc: { parents: -12 }, flags: { familyWall: true } },
      },
    ],
  },

  /* ==================================================================== *
   *  链 ⑥ 一份没退的社团报名表：club_form_unreturned
   *      → chain_club_first_meeting → chain_club_recommendation
   * ==================================================================== */
  {
    id: 'club_form_unreturned',
    name: '没交出去的那张表',
    icon: '📋',
    kind: 'choice',
    weight: 10,
    text:
      '社团招新那天你领了一张报名表，在“特长”那一栏写了三个字又划掉。两个星期过去，' +
      '这张纸还在你书包最底下，边角被压出了一道折痕。教室后墙贴着通知：这周五是最后期限。',
    choices: [
      {
        id: 'hand_in',
        label: '周五之前交上去',
        hint: '要认识一堆新面孔',
        outcome: '你把表交到了社团办公室，社长扫了一眼说“填得挺满”。第二天名单贴出来，你的名字排在最后一排。',
        effect: {
          stats: { mood: 5, social: 5, comprehensive: 2 },
          flags: { clubJoined: true },
          chain: { id: 'chain_club_first_meeting', delay: 4 },
        },
      },
      {
        id: 'tear_it',
        label: '撕了，专心读书',
        hint: '稳，时间多了出来',
        outcome: '你把表撕成四块扔进垃圾桶，晚自习多做了半张卷子。走出教室时走廊上还有人在贴海报。',
        effect: {
          stats: { mood: -3, comprehensive: 1 },
          knowledge: { weakest: 1.4, count: 1 },
          flags: { clubTorn: true },
        },
      },
      {
        id: 'kept_in_bag',
        label: '再想想，继续塞着',
        hint: '拖过期限就没了',
        outcome: '你把表又塞回书包最底下。周五那天你路过社团办公室，门口没有人，你也没有停下脚步。',
        effect: {
          stats: { mood: -4 },
          flags: { clubFormForgotten: true },
          chain: { id: 'chain_club_first_meeting', delay: 6 },
        },
      },
    ],
  },
  {
    id: 'chain_club_first_meeting',
    name: '第一次社团活动',
    icon: '🎨',
    kind: 'choice',
    chainOnly: true,
    weight: 10,
    text: (game) =>
      game.flags.clubJoined
        ? '第一次活动在实验楼三层的旧教室。社长把一沓白纸往桌上一放：“下周校园开放日，谁做海报？”' +
          '教室里安静了两秒，你举手的时候自己都愣了一下，手举得比想象中高。'
        : '名单上没有你的名字，但你还是去了那间旧教室。社长看了你一眼，说“来都来了”，' +
          '把一支笔和一张白纸推到你面前，笔杆上还留着上一个人的牙印。',
    choices: [
      {
        id: 'make_poster',
        label: '接下海报，熬两晚画完',
        hint: '很累，但会被看见',
        outcome: '你在旧教室里画到十点，保安来催了两次。海报贴出去那天，有人在旁边拍照，你绕了一圈又回来看了一遍。',
        effect: {
          stats: { comprehensive: 7, fatigue: 6, mood: 6, social: 2 },
          flags: { clubPoster: true },
          chain: { id: 'chain_club_recommendation', delay: 4 },
        },
      },
      {
        id: 'just_watch',
        label: '坐着看他们忙',
        hint: '稳，什么都没留下',
        outcome: '你坐在最后一排看了一个下午，走的时候顺手把椅子摆齐了。没人记住你来过，你也没记住谁的名字。',
        effect: { stats: { mood: 2, social: 1, comprehensive: 1 }, flags: { clubBystander: true } },
      },
      {
        id: 'do_errand',
        label: '揽下搬器材的活',
        hint: '累活，老师会记得',
        outcome: '你跑了六趟，把音响和展板从仓库搬到楼下，汗把校服后背浸透了。指导老师递给你一瓶水，问了你的名字。',
        effect: {
          stats: { fatigue: 8, physique: 3, social: 3, mood: 2 },
          npc: { head: 2 },
          flags: { clubErrand: true },
          chain: { id: 'chain_club_recommendation', delay: 4 },
        },
      },
    ],
  },
  {
    id: 'chain_club_recommendation',
    name: '指导老师的那封推荐信',
    icon: '📁',
    kind: 'choice',
    chainOnly: true,
    weight: 10,
    text: (game) =>
      game.flags.clubPoster
        ? '学期末，指导老师把你叫到办公室，桌上摊着你那张海报的留档。她说综评材料里可以附一封推荐信，' +
          '“我帮你写，但你得自己想清楚，要在里面放什么”。'
        : '学期末，指导老师把你叫到办公室。她说记得你搬了三天器材，一块展板都没磕坏，' +
          '“综评材料要推荐信的话，我可以写。但得你自己想清楚放什么”。',
    choices: [
      {
        id: 'take_letter',
        label: '收下，认真做综评材料',
        hint: '要综合实力撑得住',
        outcome: (game) =>
          game.stats.comprehensive >= 70
            ? '你把三年的东西一页一页整理成册：海报、志愿时长、社团记录，最后附上那封推荐信。老师翻完说了一句“这个能递”。'
            : '你把三年的东西整理成册，附上那封推荐信。可翻到成绩那一页时你自己先停了手——材料很好看，底子还差一点。',
        effect: (game) => {
          const base = {
            stats: { comprehensive: 7, mood: 7 },
            npc: { head: 6 },
            flags: { clubRecommendation: true, zonghe: true },
          };
          if (game.stats.comprehensive < 70) return base;
          return {
            ...base,
            text:
              '面试老师翻到推荐信那一页，抬头看了你一眼，又回头翻了翻你的海报复印件。' +
              '他合上材料说：“这样的学生我们想要。”',
            // 毕业去向：等高考结束时再结算，不在这一周结束这一局
            graduationEnding: 'zonghe',
            // zonghe 是引擎 specialEndingFor 现场拼的，不在 ENDINGS 表里，
            // 所以要把标题和正文一起带过去，否则 finish() 会退回“毕业”。
            graduationExtra: {
              id: 'zonghe',
              title: '综合评价：材料替你说话',
              tier: '综合评价',
              school: '南京师范大学 / 安徽大学（综评）',
              good: true,
              text:
                '面试老师翻着你的材料——社团海报、志愿时长、一封指导老师写的推荐信。' +
                '他抬头说：“你在二中做的事，比你的分数有意思。”你走进那扇门的时候，手里那本册子还有打印机的温度。',
            },
          };
        },
      },
      {
        id: 'give_to_friend',
        label: '让给更需要的同学',
        hint: '成人情，自己少一块',
        outcome: '你去找老师说“推荐信给{friend}吧，他材料更薄”。老师打量了你两秒，在本子上划了一笔。',
        effect: {
          stats: { mood: 8, social: 5, comprehensive: -3 },
          npc: { friend: 12, head: 3 },
          flags: { gaveLetter: true },
        },
      },
      {
        id: 'decline_letter',
        label: '觉得自己配不上，婉拒',
        hint: '稳，也不会有人记得',
        outcome: '你说“我材料还不够”。老师没劝，把那张纸收回抽屉，说“什么时候想清楚了再来”。',
        effect: {
          stats: { mood: -6, comprehensive: 2 },
          knowledge: { all: 0.8 },
          flags: { refusedLetter: true },
        },
      },
    ],
  },

  /* ==================================================================== *
   *  链 ⑦ 考试时的一个小动作：exam_peek_hand → chain_exam_peek_aftermath
   * ==================================================================== */
  {
    id: 'exam_peek_hand',
    name: '手心里的那行公式',
    icon: '🖐️',
    kind: 'choice',
    weight: 11,
    text:
      '物理卷子最后一道大题有三个小问。你昨晚背的公式就在手心里，是早上用铅笔写的，' +
      '已经蹭掉了一半。监考老师坐在讲台上翻报纸，教室里的挂钟走得很响，' +
      '前桌翻页的声音一次比一次快。',
    choices: [
      {
        id: 'peek',
        label: '摊开手心瞄一眼',
        hint: '分到手，也可能被抓',
        outcome: '你把左手翻过来压在桌角，扫了半秒就合上了。那道题你写满了，字迹比平时还要稳。',
        effect: (game) => ({
          stats: { mood: 4, comprehensive: -1 },
          flags: { peekedExam: true },
          chain: { id: 'chain_exam_peek_aftermath', delay: 4 },
          risk: [
            {
              chance: game.stats.teacherFavor <= 45 ? 0.3 : 0.12,
              text: '',
              effect: {
                text:
                  '你刚翻手，监考老师就站起来了。她走到你桌边，把你的左手从桌角拿开看了一眼，' +
                  '什么也没说，只是把卷子往你面前推了推。后半场你一个字也没写进去。',
                stats: { mood: -14, fatigue: 4 },
                npc: { head: -6 },
                flags: { peekNoticed: true },
              },
            },
          ],
        }),
      },
      {
        id: 'refuse_peek',
        label: '攥紧拳头，自己推',
        hint: '慢，但手是干净的',
        outcome: '你把左手团起来塞到桌下，从定义开始一点点推。铃响时你只写了两小问，草稿纸用掉三张。',
        effect: {
          stats: { mood: -3, fatigue: 4 },
          knowledge: { weakest: 1.8, count: 1 },
          flags: { refusedPeek: true },
        },
      },
      {
        id: 'ask_proctor',
        label: '举手要一张草稿纸',
        hint: '稳，顺便断了退路',
        outcome: '你举手要了草稿纸，老师从你旁边走过时看了一眼你摊开的手心——什么也没有。你从第一行重新推起。',
        effect: {
          stats: { comprehensive: 2, mood: 1 },
          knowledge: { weakest: 1.2, count: 1 },
          flags: { askedProctor: true },
        },
      },
    ],
  },
  {
    id: 'chain_exam_peek_aftermath',
    name: '成绩条发下来那天',
    icon: '📊',
    kind: 'choice',
    chainOnly: true,
    weight: 10,
    text: (game) =>
      game.flags.peekNoticed
        ? '成绩条贴在后墙上，你的物理比上次高了三十多分。{head}在班会上念你的名字，说“进步最大”，' +
          '念的时候朝你这边看了一眼。你想起那只被拿开的左手，想起监考老师推卷子的那一下。'
        : '成绩条贴在后墙上，你的物理比上次高了一截。{head}在班会上念你的名字，说“进步最大”。' +
          '同桌推了推你，你笑了一下，又想起手心里那半行已经被汗蹭掉的铅笔字。',
    choices: [
      {
        id: 'admit',
        label: '去办公室说明白',
        hint: '分数退回去，人轻了',
        outcome: '{head}把卷子找出来摊在桌上，你从头说了。她拿红笔把最后一道大题划掉，说“这次我记住了”。',
        effect: {
          stats: { mood: -7, discipline: -6, comprehensive: 3 },
          npc: { head: 12 },
          knowledge: { weakest: 1.2, count: 1 },
          flags: { confessedPeek: true },
        },
      },
      {
        id: 'keep_score',
        label: '把名次收下，装作自己考',
        hint: '没人问，纸包不住火',
        outcome: '你把成绩条折好放进笔袋，一路在心里演练：万一有人问，就说“蒙对了”。',
        effect: (game) => ({
          stats: { mood: 5, discipline: 4 },
          flags: { keptCheatScore: true },
          risk: [
            {
              chance: game.stats.mood <= 42 || game.npc.head <= 45 ? 0.55 : 0.28,
              text: '',
              effect: (inner) =>
                inner.stats.mood <= 34
                  ? {
                      text:
                        '月考座位是按上次名次排的，你被调到第二排，正对讲台。两周后监考老师把你上次的手心' +
                        '和这次的名次对上了，登记本被送到了教导处。你爸被叫到学校，回来说了一路的话，' +
                        '你一句也没听进去。',
                      stats: { mood: -24, discipline: 30, fatigue: 6 },
                      npc: { parents: -18, head: -24 },
                      flags: { cheatExposed: true },
                    }
                  : {
                      text:
                        '监考老师在走廊上把你叫住，问“上次物理最后一道题你是怎么推出来的”。你答得磕磕绊绊，' +
                        '她没再追问，但从那以后每次考试，她都在你旁边多站一会儿。',
                      stats: { mood: -10, fatigue: 3 },
                      npc: { head: -10 },
                      flags: { cheatSuspect: true },
                    },
            },
          ],
        }),
      },
      {
        id: 'learnt_it',
        label: '把这道题真的学会',
        hint: '花时间，换回干净分',
        outcome: '你去办公室要了一张空白卷子，用了两个晚自习把那道题的三种解法全推了一遍。{head}在草稿纸上写了“这题你会了”。',
        effect: {
          stats: { mood: 6, fatigue: 8, comprehensive: 3 },
          npc: { head: 6 },
          knowledge: { weakest: 3, count: 1 },
          flags: { madeItHonest: true },
        },
      },
    ],
  },

  /* ==================================================================== *
   *  链 ⑧ 雨山湖边的一次约定：yushanhu_lake_promise
   *      → chain_lake_promise_winter → chain_lake_promise_summer
   * ==================================================================== */
  {
    id: 'yushanhu_lake_promise',
    name: '湖边的那句约定',
    icon: '🌅',
    kind: 'choice',
    weight: 11,
    text:
      '傍晚你们绕着雨山湖走，水面上飘着几只脚踏船。走到一半{love}停下来说：“高考完那天，我们还来这儿，' +
      '你骑车带我，绕一整圈。”风把这句话吹得很轻，但你听见了，栏杆上还留着白天晒过的温度。',
    choices: [
      {
        id: 'pinky',
        label: '伸出小指，说好了',
        hint: '心动 +，也要做到',
        outcome: '你们拉了钩，还约定谁先到就买两瓶汽水。回去的路上你骑得比平时快，风灌进校服里。',
        effect: {
          stats: { mood: 9, social: 2 },
          npc: { love: 11 },
          flags: { lakePromise: true },
          chain: { id: 'chain_lake_promise_winter', delay: 6 },
        },
      },
      {
        id: 'joke_off',
        label: '笑说“到时候谁还记得”',
        hint: '轻飘飘，会被记着',
        outcome: '你笑TA太认真。{love}也笑了，说“那我记着”。后来你们聊了别的事，那句话却一直挂在那儿。',
        effect: {
          stats: { mood: 4, social: 1 },
          npc: { love: 3 },
          flags: { lakePromiseVague: true },
          chain: { id: 'chain_lake_promise_winter', delay: 6 },
        },
      },
      {
        id: 'change_subject',
        label: '岔开话题，说点别的',
        hint: '稳，也把水搅浑了',
        outcome: '你指着湖对岸说“那边在建什么”。{love}顺着看过去，停了停，说“不知道”，然后你们安静地走完了那半圈。',
        effect: {
          stats: { mood: -4, comprehensive: 1 },
          npc: { love: -5 },
          flags: { lakeAvoided: true },
        },
      },
    ],
  },
  {
    id: 'chain_lake_promise_winter',
    name: '湖面结冰的那个下午',
    icon: '❄️',
    kind: 'choice',
    chainOnly: true,
    weight: 10,
    text: (game) =>
      game.flags.lakePromiseVague
        ? '十二月的雨山湖，栏杆上结着一层白霜。{love}把手插在口袋里问你：“上次那句话，你是认真的吗？”' +
          '湖面上浮着几片薄冰，风一吹就撞在一起，发出很轻的声音。'
        : '十二月的雨山湖，栏杆上结着一层白霜。你们绕湖走了一圈，谁也没先开口，' +
          '走到上次停下的那个位置，{love}才说：“那天你说的，还算数吗？”',
    choices: [
      {
        id: 'confirm',
        label: '说算数，一定去',
        hint: '把话钉死，就得做到',
        outcome: '你说“算数”。{love}从口袋里掏出一颗糖递给你，说“这是定金”。你把糖纸压在笔袋里，一直留到六月。',
        effect: {
          stats: { mood: 10, comprehensive: 2 },
          npc: { love: 12 },
          flags: { promiseKept: true },
          chain: { id: 'chain_lake_promise_summer', delay: 5 },
        },
      },
      {
        id: 'say_later',
        label: '说“看成绩吧”，先留着',
        hint: '稳，但话就淡了',
        outcome: '你说“等分数出来再说”。{love}点了点头，说“也对”。剩下的半圈你们聊了模考排名，都不太想说话。',
        effect: {
          stats: { mood: -4, comprehensive: 2 },
          npc: { love: -4 },
          knowledge: { weakest: 1.6, count: 1 },
          flags: { promiseMaybe: true },
          chain: { id: 'chain_lake_promise_summer', delay: 5 },
        },
      },
      {
        id: 'avoid_again',
        label: '说自己那天要补课',
        hint: '把门关得很轻',
        outcome: '你说六月可能有补课。{love}“哦”了一声，那之后一路没说几句话。到校门口你们往两个方向走，都没回头。',
        effect: { stats: { mood: -8 }, npc: { love: -14 }, flags: { promiseBroken: true } },
      },
    ],
  },
  {
    id: 'chain_lake_promise_summer',
    name: '高考完的那天下午',
    icon: '💗',
    kind: 'choice',
    chainOnly: true,
    weight: 10,
    text: (game) =>
      game.flags.promiseMaybe
        ? '高考最后一科的交卷铃响过之后，你在校门口站了很久。手机里{love}的消息停在三天前：' +
          '“考完那天，你还来湖边吗？”人群一批一批地从你身边走过，没有人叫你。'
        : '高考最后一科的交卷铃响过之后，你推着自行车在校门口等。{love}从人群里挤出来，' +
          '手里拎着两瓶汽水，说：“你说好的，骑车带我绕一整圈。”',
    choices: [
      {
        id: 'go_lake',
        label: '载上TA，绕湖一整圈',
        hint: '要三年攒下的那点关系',
        outcome: (game) =>
          game.npc.love >= 65
            ? '你把车骑到湖东，TA坐在后座上，一路都在喊“慢点”。骑完一整圈天已经黑透了，你们在湖边坐到游船收工。'
            : '你载着TA骑了半圈，链条在湖西掉了。你们蹲在路灯下装了二十分钟，最后是推着车走完剩下的路。',
        effect: (game) =>
          game.npc.love >= 65
            ? {
                stats: { mood: 14, social: 4, fatigue: 4 },
                npc: { love: 10 },
                money: -12,
                flags: { lakeReunion: true },
                graduationEnding: 'love',
              }
            : {
                stats: { mood: 9, fatigue: 4 },
                npc: { love: 6 },
                money: -12,
                flags: { lakeReunion: true },
              },
      },
      {
        id: 'go_alone',
        label: '一个人去湖边坐一会儿',
        hint: '安静，也是一种告别',
        outcome: '你一个人绕着湖走了一圈，在你们停过的那个位置站了会儿。湖面上有船，船上有别人的笑声。',
        effect: { stats: { mood: 6, comprehensive: 4 }, money: -6, flags: { lakeAlone: true } },
      },
      {
        id: 'never_go',
        label: '那天没去，回家睡了',
        hint: '稳，但这辈子少一件事',
        outcome: '你回家睡了一整个下午，醒来时天快黑了。手机屏幕亮着，没有新消息——也可能有，你没点开。',
        effect: { stats: { mood: -12, fatigue: -8 }, npc: { love: -14 }, flags: { lakeMissed: true } },
      },
    ],
  },
];

/**
 * 因果链成就。
 *
 * 格式与引擎 `collectAchievements` 里手写的那批一致：flag 在这一局为真，结算时就会收录。
 * 八条链一条一个，正好对上。
 */
export const CHAIN_ACHIEVEMENTS = [
  { flag: 'lendLetGo', icon: '🎧', name: '不计较的人', desc: '耳机上多了道划痕，你只说了一句“能听就行”' },
  { flag: 'confessedForgery', icon: '📄', name: '自己把话说开', desc: '签字栏上的那半行描过的字，最后是你先承认的' },
  { flag: 'helpedStranger', icon: '🛒', name: '在菜市场搭过手', desc: '蹲在马路牙子上，帮人把链条挂回了齿轮上' },
  { flag: 'publishedWork', icon: '🎬', name: '第一件作品', desc: '被窝里练出来的两分钟，终于有人看见了' },
  { flag: 'brokeIce', icon: '🍚', name: '先端碗的那个人', desc: '冷战第三天，你端着碗进了厨房' },
  { flag: 'clubPoster', icon: '🎨', name: '贴在楼门口的海报', desc: '第一次有人把你的画钉在教学楼门口' },
  { flag: 'madeItHonest', icon: '🖐️', name: '把分还回去的人', desc: '不该得的那道题，你用两个晚自习真的学会了' },
  { flag: 'promiseKept', icon: '🌅', name: '雨山湖的约定', desc: '从秋天记到六月，你最后还是骑车去了' },
];
