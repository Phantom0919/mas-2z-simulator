/**
 * 第五批随机事件：**校园日常与本地生活**。
 *
 * 前四批把"离谱的事"和"校历上的大事"写得差不多了，这一批补的是中间那层：
 * 广播站点歌、课桌上的刻字、轮到你值日、濮塘的竹林、老市里的面馆、
 * 健康路的理发店、电动车的最后一格电、一个人在食堂吃饭……
 *
 * 写这一批的三条原则：
 *   1. 每个 choice 事件都是三个选项，里面**只有一个**是"稳但收益低"，
 *      另外两个都带风险或代价，逼玩家真的纠结一下；
 *   2. "状态差才会出事"用 `risk` 表达（体质 / 心情 / 疲劳低于某个值时才给重惩罚），
 *      风格照抄 events4.js 的 street_stall；
 *   3. 两条特殊路线直接用 `ending` 字段送进结局：
 *        - `netbar_amateur_cup` → `esports`（好结局：职业青训）
 *        - `part_time_rebate_scam` → `scam`（坏结局：刷单被骗光）
 *      结局 id 由引擎登记，这里只负责引用。
 *
 * 时间约束统一登记在 `src/data/calendar.js` 的 EVENT_SCHEDULE 里。
 * 自检脚本：`node tools/check-events5.mjs`。
 */

export const CAMPUS_EVENTS = [
  /* --------------------------------------------- 校园日常 */
  {
    id: 'broadcast_station_shift',
    name: '广播站的点歌单',
    icon: '📻',
    kind: 'choice',
    weight: 9,
    text:
      '午休的广播站里只有你和一台老功放。桌上摊着这周的点歌单，第三行写着你同桌的名字，' +
      '后面跟了两个字："全班"。学姐把话筒推过来："下午我请假，你替我播。"',
    choices: [
      {
        id: 'read_list',
        label: '照单子念完，一句不多',
        hint: '稳，没人记得住',
        outcome: '你端着稿子念了二十分钟，声音有点抖，但一个字也没念错。回教室只有同桌说了句"还行"。',
        effect: { stats: { mood: 3, discipline: -2, social: 1, fatigue: 1 }, knowledge: { chinese: 0.6 } },
      },
      {
        id: 'extra_wish',
        label: '多加一句给同桌的祝福',
        hint: '好感 +，会被起哄',
        outcome:
          '念到第三行的时候，你多加了半句"祝她月考顺利"。整栋楼都在吹口哨，同桌把脸埋进了胳膊里。',
        effect: { stats: { mood: 5, social: 4, teacherFavor: -1 }, npc: { deskmate: 7 }, flags: { broadcastShoutout: true } },
      },
      {
        id: 'go_live',
        label: '推掉稿子，即兴放首歌',
        hint: '很爽，累垮会翻车',
        outcome:
          '你把稿子往桌上一推，放了首老歌，还即兴点评了两句。午休的最后十分钟，整栋教学楼都在跟着哼。',
        effect: (game) => ({
          stats: { mood: 8, social: 5, fatigue: 3 },
          flags: { broadcastStar: true },
          risk: [
            {
              // 状态好的时候只是"被老师瞪一眼"，心情低到谷底就会当众翻车
              chance: game.stats.mood <= 35 ? 0.6 : 0.22,
              text: '',
              effect: (inner) => {
                if (inner.stats.mood <= 28) {
                  return {
                    text:
                      '你把同桌的名字念成了隔壁班同学的，还顺手把"月考"说成了"高考"。' +
                      '广播传遍了三栋楼，下午班主任把你叫到走廊上站了十分钟。' +
                      '回教室的路上，你听见有人在学你刚才的腔调。',
                    stats: { mood: -13, social: -6, teacherFavor: -5 },
                    npc: { head: -4, deskmate: -5 },
                    flags: { broadcastBlunder: true },
                  };
                }
                return {
                  text: '你放歌放到一半被德育处的老师推门打断，剩下的午休改成了"广播站纪律学习"。',
                  stats: { mood: -4, teacherFavor: -2 },
                };
              },
            },
          ],
        }),
      },
    ],
  },
  {
    id: 'desk_carving_words',
    name: '课桌上的那行字',
    icon: '✏️',
    kind: 'choice',
    weight: 8,
    text:
      '开学换座位，你分到靠窗第三排。桌面上刻着一行歪歪扭扭的字："六月八日，我尽力了"，' +
      '旁边还有三个字："数学去死"。你用湿巾擦了两下，没擦掉。',
    choices: [
      {
        id: 'scrub_off',
        label: '拿橡皮一点一点磨掉',
        hint: '稳，占掉一节自习',
        outcome: '你磨了整整一节课，桌面白了一块，那行字只剩浅浅的印子。班主任路过看了你一眼，什么也没说。',
        effect: { stats: { discipline: -3, fatigue: 2, mood: 1 }, knowledge: { all: -0.4 } },
      },
      {
        id: 'carve_mine',
        label: '在下面刻一行自己的',
        hint: '心情 +，可能被追查',
        outcome: '你借来同桌的圆规，在最下面刻上"我也尽力"。刻完手心全是汗，指甲缝里都是木屑。',
        effect: (game) => ({
          stats: { mood: 6, fatigue: 2 },
          flags: { deskCarving: true },
          risk: [
            {
              chance: game.stats.mood <= 40 ? 0.4 : 0.2,
              text: '',
              effect: {
                text:
                  '第二天年级组查"桌容桌貌"，老师凭字迹找到了你。你在办公室站了半小时，' +
                  '还领回一张《爱护公物》的检查，要家长签字。',
                stats: { mood: -8, teacherFavor: -5, discipline: 4 },
                npc: { head: -4, parents: -2 },
                flags: { deskCarvingBusted: true },
              },
            },
          ],
        }),
      },
      {
        id: 'ask_head',
        label: '去问班主任这是谁刻的',
        hint: '老师好感 +，或挨训',
        outcome:
          '班主任低头看了看那行字，说这张桌子他见了三年："有的人刻字是为了记住，有的人是为了忘掉。"',
        effect: (game) => ({
          stats: { mood: 2, comprehensive: 1 },
          npc: { head: 4 },
          risk: [
            {
              chance: game.npc.head <= 50 ? 0.4 : 0.15,
              text: '',
              effect: {
                text:
                  '他忽然把话头拐到你身上："你这次月考数学多少分？"接下来的二十分钟' +
                  '变成了谈话，你站着听完了全程，回教室时腿有点麻。',
                stats: { mood: -5, fatigue: 2 },
                npc: { head: -2 },
              },
            },
          ],
        }),
      },
    ],
  },
  {
    id: 'cleaning_duty_escape',
    name: '轮到你值日那天',
    icon: '🧹',
    kind: 'choice',
    weight: 10,
    text:
      '最后一节课的下课铃一响，全班像被抽走了椅子。黑板没擦，垃圾桶满了，走廊的值日表上写着你的名字。' +
      '同桌已经背好书包，在门口冲你比了个"快跑"的手势。',
    choices: [
      {
        id: 'do_it_all',
        label: '留下把活全干完',
        hint: '稳，最累，走得最晚',
        outcome:
          '你擦了黑板、倒了垃圾、拖了走廊，锁门的时候教学楼只剩两盏灯。回家路上你觉得自己还挺结实。',
        effect: {
          stats: { discipline: -4, physique: 2, fatigue: 6, mood: 1, teacherFavor: 2 },
          npc: { head: 2 },
          flags: { dutyHero: true },
        },
      },
      {
        id: 'split_work',
        label: '拉住同桌一起干',
        hint: '快一半，看交情',
        outcome: '你俩一人一半，十分钟解决。同桌边走边骂你，第二天还是把早饭分了你一半。',
        effect: (game) => ({
          stats: { discipline: -2, fatigue: 2, social: 3 },
          npc: { deskmate: 3 },
          risk: [
            {
              chance: game.npc.deskmate <= 40 ? 0.45 : 0.15,
              text: '',
              effect: {
                text:
                  '同桌把抹布往水桶里一扔："凭什么是我？"他背着书包走了，门摔得整层楼都听见。' +
                  '第二天你们谁也没先开口，那一桶脏水在墙角放了两天。',
                stats: { mood: -7, social: -3 },
                npc: { deskmate: -8 },
              },
            },
          ],
        }),
      },
      {
        id: 'run_away',
        label: '跟着同桌一起跑',
        hint: '省时间，可能被记名',
        outcome: '你们抄近路从后门溜了。晚风很好，路边的炸串很香，值日表还挂在走廊上。',
        effect: (game) => ({
          stats: { mood: 5, fatigue: -2 },
          npc: { deskmate: 4 },
          flags: { skippedDuty: true },
          risk: [
            {
              chance: 0.4,
              text: '',
              effect: {
                text:
                  '第二天早上，值日表被人用红笔圈了出来。班主任让你一个人拖整层楼的走廊，' +
                  '连着拖了一周，每天提前二十分钟到校。',
                stats: { discipline: 5, fatigue: 8, teacherFavor: -4, mood: -4 },
                npc: { head: -3 },
              },
            },
          ],
        }),
      },
    ],
  },

  /* --------------------------------------------- 马鞍山本地生活 */
  {
    id: 'putang_bamboo_hike',
    name: '濮塘竹林的那段坡',
    icon: '🎋',
    kind: 'choice',
    weight: 11,
    text:
      '周末，几个同学约着骑车去濮塘。竹叶把天遮成一条一条的绿，上坡推车推了四十分钟，' +
      '前面还有一段没有台阶的野路。有人回头喊："到顶就有风！"',
    choices: [
      {
        id: 'climb_top',
        label: '继续上，一定要到顶',
        hint: '很爽；体质差会中暑',
        outcome: '你把车锁在竹林口，手脚并用爬上了最后那段坡。山顶的风一吹，整片竹海都在响。',
        effect: (game) => ({
          stats: { mood: 9, physique: 4, fatigue: 8, social: 3 },
          flags: { putangReached: true },
          risk: [
            {
              // 体质差 + 大太阳 + 没带水 = 中暑
              chance: game.stats.physique < 45 ? 0.5 : 0.2,
              text: '',
              effect: (inner) => {
                if (inner.stats.physique <= 34) {
                  return {
                    text:
                      '爬到一半你就开始耳鸣，眼前一圈一圈地黑。同学把你扶到树荫下灌了半瓶水，' +
                      '最后是两个人架着你下的山。\n' +
                      '回市区挂了急诊，医生说是中暑加脱水，让你这周别上体育课，也别再熬夜。',
                    stats: { physique: -22, mood: -10, fatigue: 18 },
                    npc: { parents: 5 },
                    flags: { putangHeatstroke: true },
                  };
                }
                return {
                  text:
                    '你在半坡上坐了十分钟，心跳得像敲鼓。同学递来一瓶水，说"要不就到这儿吧"。' +
                    '你们在半山腰看了会儿竹子就下山了，竹笋没挖到，鞋倒是全是泥。',
                  stats: { physique: -6, mood: -3, fatigue: 10 },
                };
              },
            },
          ],
        }),
      },
      {
        id: 'rest_shade',
        label: '在半山腰等他们',
        hint: '稳，省力，少点故事',
        outcome: '你在竹林边找了块石头坐下，听了一小时竹叶声，还背了半篇课文。他们下来时你已经睡着了。',
        effect: { stats: { mood: 4, fatigue: -3, comprehensive: 1 }, knowledge: { all: 0.4 } },
      },
      {
        id: 'bamboo_shoots',
        label: '不爬山，跟着挖笋',
        hint: '轻松，看护林员脸色',
        outcome: '你跟着竹林边的老伯挖了两根笋，手上全是泥。老伯说这是"看山的规矩"，走的时候还塞给你一把。',
        effect: (game) => ({
          stats: { mood: 6, physique: 1, social: 2 },
          money: -15,
          risk: [
            {
              chance: 0.2,
              text: '',
              effect: {
                text: '你刚下铲，护林员的喇叭就响了："那片是承包的！"你被训了十分钟，还赔了三十块。',
                money: -30,
                stats: { mood: -4 },
                flags: { bambooFined: true },
              },
            },
          ],
        }),
      },
    ],
  },
  {
    id: 'laoshili_noodle_shop',
    name: '老市里的那碗面',
    icon: '🍜',
    kind: 'choice',
    weight: 9,
    text:
      '放学绕路去老市里，街口那家面馆的招牌掉了半边漆。老板一边下面一边喊："还是老样子？"' +
      '墙上贴着"加蛋两块，加牛肉八块"，你摸了摸兜，一共二十。',
    choices: [
      {
        id: 'plain_bowl',
        label: '一碗素面，吃完回家',
        hint: '稳，便宜，管饱',
        outcome: '八块钱的素面，汤是大骨头熬的。你连汤都喝完了，出门时天刚黑。',
        effect: { money: -8, stats: { mood: 4, physique: 2, fatigue: -2 } },
      },
      {
        id: 'add_beef',
        label: '加牛肉加蛋，奢侈一次',
        hint: '很爽，钱袋子变薄',
        outcome: '老板给你多加了一勺牛肉，说"学生要吃饱"。你吃到撑，出门的时候打了个嗝。',
        effect: { money: -19, stats: { mood: 9, physique: 3, fatigue: -4 }, flags: { noodleRegular: true } },
      },
      {
        id: 'treat_rival',
        label: '请{rival}也来一碗',
        hint: '好感 +，钱包疼',
        outcome: '你喊住了从门口经过的{rival}。两碗面端上来，热气把玻璃糊白了，你们谁也没提月考。',
        effect: {
          money: -24,
          stats: { mood: 5, social: 3 },
          npc: { rival: 8 },
          flags: { noodleTreat: true },
        },
      },
    ],
  },
  {
    id: 'jiankang_road_barber',
    name: '健康路的理发店',
    icon: '✂️',
    kind: 'auto',
    weight: 7,
    text:
      '健康路那家开了二十年的理发店，师傅一边剪一边跟你聊马钢的老同事。剪到一半他停下来问：' +
      '"还是短一点？"你想起班主任在班会上提过男生头发的事，就"嗯"了一声。',
    effect: {
      money: -15,
      stats: { mood: 3, discipline: -4, social: 1, physique: 0.5 },
      npc: { head: 2 },
      flags: { buzzCut: true },
      text: '推子响完，镜子里的人有点陌生。第二天进教室，班主任在门口多看了你两眼，说"这样就对了"。',
    },
  },

  /* --------------------------------------------- 家庭 */
  {
    id: 'ebike_battery_dead',
    name: '电动车的最后一格电',
    icon: '🛵',
    kind: 'choice',
    weight: 10,
    text:
      '早上出门时仪表盘还剩两格电，你妈说"够用"。晚上九点半，你骑到湖东路，第三格灯灭了。' +
      '离家还有四公里，后座上是两袋米和一箱牛奶。',
    choices: [
      {
        id: 'push_home',
        label: '推着车走回去',
        hint: '硬扛；体质差会病倒',
        outcome: '你把米和牛奶绑在后座上，推着车沿路灯走。四公里走了五十分钟，到家腿都在抖。',
        effect: (game) => ({
          stats: { physique: 3, mood: 4, fatigue: 12 },
          npc: { parents: 4 },
          flags: { pushedEbike: true },
          risk: [
            {
              // 体质差 + 淋雨 + 四公里 = 直接发烧
              chance: game.stats.physique < 45 ? 0.5 : 0.2,
              text: '',
              effect: (inner) => {
                if (inner.stats.physique <= 34) {
                  return {
                    text:
                      '走到一半开始下雨。你把外套盖在米袋上，自己淋透了。\n' +
                      '当天夜里你就开始发烧，第二天没去上课，体温三十九度二。' +
                      '你妈请了半天假在家守着你，一边换毛巾一边说"下次别硬撑"。',
                    stats: { physique: -20, mood: -8, fatigue: 16 },
                    npc: { parents: 3 },
                    flags: { ebikeFever: true },
                  };
                }
                return {
                  text: '半路下起小雨，你推着车跑了一段。到家打了个喷嚏，喝了两碗热汤才压下去。',
                  stats: { physique: -5, mood: -2, fatigue: 6 },
                };
              },
            },
          ],
        }),
      },
      {
        id: 'call_dad',
        label: '打电话让家里来接',
        hint: '稳，会被念两句',
        outcome: '你爸开着车来了，一边搬米一边念了五分钟电费。回家你妈给你热了饭，把充电器插上才去睡。',
        effect: { stats: { mood: 1, fatigue: -4 }, npc: { parents: 5 } },
      },
      {
        id: 'park_and_walk',
        label: '把车锁路边，自己走',
        hint: '明天还得回来取车',
        outcome: '你把车锁在超市门口，空着手走回家。第二天早上六点半，你妈骑车带你去把车推了回来。',
        effect: { money: -10, stats: { mood: -2, fatigue: 3, physique: 1 }, npc: { parents: 2 } },
      },
    ],
  },
  {
    id: 'moving_house_boxes',
    name: '家里要搬家了',
    icon: '📦',
    kind: 'choice',
    weight: 8,
    text:
      '租了六年的老房子月底要退租，你妈开始往纸箱里装东西。阳台上堆着你的旧课本、一辆小了的自行车，' +
      '还有小学的奖状。她把这些推到你面前："哪些要留，你自己挑。"',
    choices: [
      {
        id: 'keep_books',
        label: '课本全留，一箱都不扔',
        hint: '稳，搬家累一点',
        outcome: '你用胶带封了三个箱子，每一箱都写上科目。搬到新家那天，你一个人扛上了五楼。',
        effect: {
          stats: { fatigue: 8, physique: 3, comprehensive: 2, discipline: -2 },
          npc: { parents: 3 },
          knowledge: { all: 0.5 },
        },
      },
      {
        id: 'throw_old',
        label: '把没用的全扔了',
        hint: '轻松，心里空一下',
        outcome: '你扔掉了两大袋卷子和一摞没写完的练习册。垃圾车开走的时候，你站在楼下看了很久。',
        effect: (game) => ({
          stats: { mood: -5, fatigue: -4, discipline: -3 },
          knowledge: { weakest: -1, count: 1 },
          risk: [
            {
              chance: 0.3,
              text: '',
              effect: {
                text:
                  '收拾到一半，你翻出一本小学的作文本，第一页写着"我长大想当科学家"。' +
                  '你坐在地板上看了很久，那天下午什么也没干，箱子还是摊着的。',
                stats: { mood: -7, fatigue: 2 },
              },
            },
          ],
        }),
      },
      {
        id: 'sell_stuff',
        label: '旧书旧车挂二手平台卖掉',
        hint: '能换钱，要花时间',
        outcome: '你拍了一晚上照片，把旧教辅和小自行车挂了上去。三天后卖掉一半，赚了点零花钱。',
        effect: (game) => ({
          money: 120,
          stats: { fatigue: 4, social: 2, comprehensive: 1 },
          flags: { soldBelongings: true },
          risk: [
            {
              chance: 0.25,
              text: '',
              effect: {
                text:
                  '一个买家说好周末来取，你等了两个下午。最后他把你拉黑了，书还堆在客厅，' +
                  '你妈念叨了三天"占地方"。',
                money: -20,
                stats: { mood: -5 },
              },
            },
          ],
        }),
      },
    ],
  },
  {
    id: 'new_year_kitchen_help',
    name: '年夜饭的帮厨',
    icon: '🥟',
    kind: 'auto',
    weight: 8,
    text:
      '除夕下午四点，厨房里全是雾。你妈在剁肉，你爸在炸圆子，灶上炖着你姥姥传下来的那锅汤。' +
      '你被喊进去包饺子，手上的面粉一直沾到手腕。',
    effect: {
      money: 60,
      stats: { mood: 6, fatigue: 3, physique: 1, social: 1 },
      npc: { parents: 6 },
      flags: { madeDumplings: true },
      text:
        '你包的饺子有三只漏了馅。吃饭的时候你妈说"这是你包的"，你爸一口气全吃了，还说好吃，' +
        '然后从口袋里摸出一个红包塞给你。',
    },
  },

  /* --------------------------------------------- 友情与冲突 */
  {
    id: 'borrow_notes_refused',
    name: '借笔记被回绝',
    icon: '📒',
    kind: 'choice',
    weight: 10,
    text:
      '月考之前，你去找班里笔记记得最好的那个同学借错题本。他从座位上抬起头，看了你两秒，' +
      '说："我自己还要用。"走廊里正好有风，吹得你课本的角翻了起来。',
    choices: [
      {
        id: 'walk_off',
        label: '说声没事，回去自己抄',
        hint: '稳，慢，但踏实',
        outcome: '你回座位把自己的错题从头抄了一遍，抄到手上沾了墨。笔记是自己的，但那晚坐到十一点半。',
        effect: {
          stats: { fatigue: 4, mood: -1, discipline: -3, comprehensive: 2 },
          knowledge: { weakest: 1.6, count: 1 },
        },
      },
      {
        id: 'ask_friend',
        label: '去问{friend}有没有',
        hint: '看交情，可能被拒',
        outcome: '你转头去找{friend}。他翻了翻书包，掏出一本卷了边的："字丑，别嫌。"',
        effect: (game) => ({
          stats: { mood: 3, social: 2 },
          npc: { friend: 6 },
          knowledge: { weakest: 1.2, count: 1 },
          risk: [
            {
              chance: game.npc.friend <= 35 ? 0.4 : 0.12,
              text: '',
              effect: {
                text:
                  '{friend}摊了摊手："我自己的都没整理完。"一天之内被拒两次，你回座位的路上' +
                  '觉得自己像在挨个敲门。',
                stats: { mood: -7, social: -2 },
                npc: { friend: -2 },
              },
            },
          ],
        }),
      },
      {
        id: 'borrow_rival',
        label: '去找{rival}试试',
        hint: '有风险，面子挂不住',
        outcome: '你敲了{rival}的桌子。他愣了一下，把错题本合上推过来："明天早上还我。"',
        effect: (game) => ({
          stats: { social: 2, comprehensive: 2 },
          npc: { rival: 7 },
          knowledge: { math: 2 },
          risk: [
            {
              chance: 0.35,
              text: '',
              effect: {
                text:
                  '{rival}笑了一声："你也来借我的？"那句话在班里传了一整天，' +
                  '晚自习你一直没抬头，笔记最后也没借成。',
                stats: { mood: -8, social: -3 },
                npc: { rival: -3 },
              },
            },
          ],
        }),
      },
    ],
  },
  {
    id: 'quarrel_apology_late',
    name: '吵完架的第三天',
    icon: '🤝',
    kind: 'choice',
    weight: 9,
    text:
      '三天前，你和{deskmate}在走廊上吵了一架，起因是一支被踩坏的笔。这三天你们共用一张桌子，' +
      '谁也不说话，橡皮掉在地上，都要用脚尖踢过去。',
    choices: [
      {
        id: 'apologize_first',
        label: '先开口说对不起',
        hint: '要勇气，可能被晾',
        outcome: '你把一支新笔放在他桌子中间。他看了两秒，说"那笔本来也没多贵"。第四天你们又开始互相抄作业了。',
        effect: (game) => ({
          stats: { mood: 6, social: 4 },
          npc: { deskmate: 9 },
          flags: { apologyMade: true },
          risk: [
            {
              chance: game.npc.deskmate <= 35 ? 0.35 : 0.1,
              text: '',
              effect: {
                text:
                  '他把笔推了回来："不用。"那支笔在你桌上放了整整一周，' +
                  '你们到期末都没再说过一句话，桌子中间那道缝越来越像国界。',
                stats: { mood: -9, social: -3 },
                npc: { deskmate: -6 },
              },
            },
          ],
        }),
      },
      {
        id: 'stay_cold',
        label: '继续冷战，看谁先撑不住',
        hint: '稳，但一直憋着',
        outcome: '你俩又僵了半个学期。期中换座位那天，他搬走桌子，回头看了一眼，你假装在写题。',
        effect: {
          stats: { mood: -5, social: -3, discipline: -2, comprehensive: 2 },
          npc: { deskmate: -5 },
          knowledge: { all: 0.6 },
        },
      },
      {
        id: 'write_note',
        label: '写张纸条塞进他书里',
        hint: '不尴尬，可能没回应',
        outcome: '你在纸条上写了两行字，塞进他的数学书。第二天他什么也没说，但把你的水杯从窗台挪到了他那边。',
        effect: (game) => ({
          stats: { mood: 3, social: 2 },
          npc: { deskmate: 5 },
          risk: [
            {
              chance: 0.2,
              text: '',
              effect: {
                text:
                  '纸条被他同桌翻出来念了一遍，念到"对不起"的时候全班都笑了。' +
                  '他脸涨得通红，把纸条揉成一团塞进了抽屉。',
                stats: { mood: -6, social: -4 },
                npc: { deskmate: -3 },
              },
            },
          ],
        }),
      },
    ],
  },
  {
    id: 'lunch_alone_isolation',
    name: '一个人在食堂',
    icon: '🍱',
    kind: 'choice',
    weight: 8,
    text:
      '换座位以后，原来一起吃饭的那几个人突然凑成了另一桌。你端着餐盘在二楼转了一圈，' +
      '卖红烧肉的窗口已经排到楼梯口，没有一把椅子上坐着你认识的人。',
    choices: [
      {
        id: 'sit_alone',
        label: '随便找个角落一个人吃',
        hint: '稳，安静，有点难受',
        outcome: '你坐在靠窗的角落把饭吃完，还背了十个单词。收餐盘的时候你觉得自己其实也能行。',
        effect: { stats: { mood: -4, discipline: -3, comprehensive: 2 }, knowledge: { english: 2 } },
      },
      {
        id: 'join_others',
        label: '厚着脸皮坐到隔壁桌',
        hint: '要胆子，可能被冷落',
        outcome: '你端着盘子站在桌边问："这儿有人吗？"对面挪了挪盘子，你就坐下了。整顿饭你只说了三句话。',
        effect: (game) => ({
          stats: { social: 5, mood: 5 },
          npc: { friend: 5 },
          risk: [
            {
              chance: game.stats.social <= 30 ? 0.4 : 0.15,
              text: '',
              effect: {
                text:
                  '整桌人聊着另一个班的事，没人接你的话。你把饭吃完，端着空盘走的时候，' +
                  '背后有人小声笑了一下。',
                stats: { mood: -9, social: -2 },
              },
            },
          ],
        }),
      },
      {
        id: 'call_old_friend',
        label: '打电话约初中同学吃饭',
        hint: '心情 +，路远花钱',
        outcome: '周末你坐公交去了趟老市里，初中的老同学点了两个菜。你们聊了两小时初中，谁也没提成绩。',
        effect: {
          money: -45,
          stats: { mood: 8, social: 3, fatigue: 2 },
          npc: { friend: 3 },
          flags: { oldFriendMeal: true },
        },
      },
    ],
  },

  /* --------------------------------------------- 高三压力 */
  {
    id: 'mock_exam_phone_home',
    name: '模考成绩和那通电话',
    icon: '📞',
    kind: 'choice',
    weight: 12,
    text:
      '模考成绩出来，你比上次掉了六十多名。晚自习前，你在操场的电话亭边站了十分钟，' +
      '手机屏幕上亮着"妈"两个字。旁边有同学在打球，球砸在铁架上，一声一声的。',
    choices: [
      {
        id: 'tell_truth',
        label: '照实说，还说了错在哪',
        hint: '稳，说完心里空',
        outcome: '电话那头静了两秒，你妈说："知道错哪就行，明天想吃什么。"挂了电话你在操场站了会儿。',
        effect: {
          stats: { mood: 2, social: 1, comprehensive: 2 },
          npc: { parents: 6 },
          flags: { toldParentsTruth: true },
          knowledge: { weakest: 1.2, count: 2 },
        },
      },
      {
        id: 'hide_score',
        label: '说"还行"，然后挂了',
        hint: '保面子，心里积压',
        outcome: '你说"还行，比上次好一点"。挂了电话你盯着那个名次看了很久，回教室把卷子塞到了最底下。',
        effect: (game) => ({
          stats: { mood: 3, comprehensive: 1 },
          npc: { parents: 1 },
          risk: [
            {
              // 心里本来就堵着，还瞒一次，回家就要炸
              chance: game.stats.mood <= 40 ? 0.55 : 0.25,
              text: '',
              effect: (inner) => {
                if (inner.stats.mood <= 30) {
                  return {
                    text:
                      '周末回家，你妈已经从班主任的群里看到了完整排名。饭桌上谁也没说话，' +
                      '你爸把碗一推进了房间。那一晚你在被子里躺到两点，第二天早读照样要起床。',
                    stats: { mood: -16, fatigue: 8 },
                    npc: { parents: -12 },
                    flags: { liedAboutScore: true },
                  };
                }
                return {
                  text: '你妈在电话里顿了顿，只说了句"行吧"。挂了之后你又后悔了，第二天一整天提不起劲。',
                  stats: { mood: -5 },
                };
              },
            },
          ],
        }),
      },
      {
        id: 'promise_rank',
        label: '当场立个军令状',
        hint: '压力换动力，可能压垮',
        outcome: '你说"下次一定进前一百"。电话那头笑了，你却在心里把接下来三周的作息表排了一遍。',
        effect: (game) => ({
          stats: { fatigue: 6, comprehensive: 3, mood: -3 },
          npc: { parents: 5 },
          knowledge: { weakest: 2.2, count: 2 },
          flags: { mockPromise: true },
          risk: [
            {
              // 心情已经很低或者人已经熬干了，再立军令状就是压垮骆驼
              chance: game.stats.mood <= 38 || game.stats.fatigue >= 70 ? 0.5 : 0.2,
              text: '',
              effect: {
                text:
                  '你连着两周熬到一点半。第三次模考前一晚，你盯着卷子上的字发抖，什么也读不进去，' +
                  '最后是被同桌扶去医务室的。医生让你这几天别看卷子。',
                stats: { mood: -14, fatigue: 14, physique: -8 },
                npc: { parents: -3 },
                flags: { burntOut: true },
              },
            },
          ],
        }),
      },
    ],
  },
  {
    id: 'volunteer_form_dispute',
    name: '志愿表上的分歧',
    icon: '🎯',
    kind: 'choice',
    weight: 11,
    text:
      '志愿表发下来的那天晚上，客厅的灯开得特别亮。你爸把招生计划翻得哗哗响，说"学医稳当"；' +
      '你妈说"离家近点好"。而你心里想着那个写在草稿纸角落里的专业。',
    choices: [
      {
        id: 'follow_parents',
        label: '听爸妈的，填稳妥那一栏',
        hint: '稳，心里不甘',
        outcome: '你按着他们画的圈填了六个志愿。交表那天，你妈在楼下跟邻居说了半天"我家孩子懂事"。',
        effect: {
          stats: { mood: -6, comprehensive: 2, social: 1 },
          npc: { parents: 9 },
          flags: { volunteerLocked: true, followedParents: true },
        },
      },
      {
        id: 'insist_own',
        label: '把自己的专业填在第一栏',
        hint: '很爽，家里可能翻脸',
        outcome: '你把草稿纸上的那个专业工工整整写在了第一志愿。晚饭桌上你爸一句话没说，只把汤喝完了。',
        effect: (game) => ({
          stats: { mood: 6, comprehensive: 2 },
          npc: { parents: -4 },
          flags: { volunteerLocked: true, choseOwnMajor: true },
          risk: [
            {
              chance: game.npc.parents <= 55 ? 0.5 : 0.2,
              text: '',
              effect: {
                text:
                  '你爸把招生计划合上，说了句"随你"，然后一整周没怎么跟你说话。' +
                  '你妈半夜起来给你留了张纸条："别怪他，他也是怕你吃苦。"',
                stats: { mood: -12, fatigue: 4 },
                npc: { parents: -10 },
                flags: { familyColdWar: true },
              },
            },
          ],
        }),
      },
      {
        id: 'ask_head_form',
        label: '第二天去问{head}怎么填',
        hint: '老师好感 +，未必有用',
        outcome:
          '{head}把你的成绩条和招生计划摆在一起，画了半小时，最后说："你适合哪个，你自己比我清楚。"',
        effect: (game) => ({
          stats: { mood: 3, comprehensive: 2 },
          npc: { head: 5 },
          flags: { volunteerLocked: true },
          knowledge: { all: 0.3 },
          risk: [
            {
              chance: 0.2,
              text: '',
              effect: {
                text: '办公室正好有几个老师在聊今年的分数线，越聊越吓人。你出来的时候手心是凉的。',
                stats: { mood: -5 },
              },
            },
          ],
        }),
      },
    ],
  },
  {
    id: 'mom_midnight_light',
    name: '半夜门缝里的光',
    icon: '🚪',
    kind: 'auto',
    weight: 8,
    text:
      '凌晨一点，你还在台灯下改错题。门被轻轻推开一条缝，你妈端着一碗热牛奶站在门口，' +
      '没有进来，只是把碗放在门口的凳子上，又轻轻把门带上了。',
    effect: {
      stats: { mood: 5, fatigue: -6, physique: 1 },
      npc: { parents: 5 },
      flags: { momMidnightSoup: true },
      text: '你端着那碗牛奶站了一会儿，杯子是温的。你想起她明天六点还要起来做饭。',
    },
  },

  /* --------------------------------------------- 手机与诱惑 */
  {
    id: 'short_video_loop',
    name: '短视频刷到凌晨',
    icon: '📱',
    kind: 'choice',
    weight: 12,
    text:
      '熄灯之后你钻进被子里，本来只想看五分钟。算法比你自己更懂你——下一个视频永远比这个更好笑。' +
      '等你抬头，室友的呼噜已经打了两个小时。',
    choices: [
      {
        id: 'keep_scrolling',
        label: '再看十个就睡',
        hint: '很爽，第二天人废一半',
        outcome:
          '你刷到凌晨两点四十，最后一条是一个高中生讲自己怎么考上清华的。你把手机扣在枕头下，天已经有点灰。',
        effect: (game) => ({
          stats: { mood: 6, fatigue: 12 },
          flags: { stayedUpShortVideo: true },
          risk: [
            {
              // 心情差 / 人已经熬干的时候，这一夜就是压下去的最后一根稻草
              chance: game.stats.mood <= 40 || game.stats.fatigue >= 65 ? 0.5 : 0.2,
              text: '',
              effect: (inner) => {
                if (inner.stats.mood <= 32) {
                  return {
                    text:
                      '第二天早读你趴了整节课，被班主任叫到走廊上。他说"你最近眼神不对"。\n' +
                      '那天中午你连饭都没吃就睡了，梦见自己在刷视频，醒了发现手还在划屏幕。',
                    stats: { mood: -14, fatigue: 10, physique: -6, discipline: 4 },
                    npc: { head: -5 },
                    flags: { phoneHabit: true },
                  };
                }
                return {
                  text: '第二天你靠两罐咖啡撑过上午，数学课上睡过去十分钟，醒来时黑板已经写满了两块。',
                  stats: { mood: -5, fatigue: 6 },
                  knowledge: { math: -0.6 },
                };
              },
            },
          ],
        }),
      },
      {
        id: 'delete_app',
        label: '当场把APP卸了',
        hint: '稳，手会痒',
        outcome: '你当着室友的面点了卸载，还把手机丢在枕头另一头。第二天你摸空了好几次，晚自习效率却高得离谱。',
        effect: {
          stats: { mood: -2, discipline: -4, fatigue: -4 },
          knowledge: { all: 1.1 },
          flags: { quitShortVideo: true },
        },
      },
      {
        id: 'listen_music',
        label: '改成戴着耳机听歌睡',
        hint: '稳一点，也可能失眠',
        outcome: '你换了首歌单循环，把屏幕朝下扣着。三首歌之后你睡着了，耳机线缠在脖子上。',
        effect: (game) => ({
          stats: { mood: 4, fatigue: -3 },
          knowledge: { all: 0.2 },
          risk: [
            {
              chance: 0.25,
              text: '',
              effect: {
                text:
                  '一首歌循环到第四十遍的时候你彻底清醒了。凌晨三点，你数着室友的呼吸声，' +
                  '第二天顶着黑眼圈进教室。',
                stats: { mood: -6, fatigue: 7 },
              },
            },
          ],
        }),
      },
    ],
  },
  {
    id: 'netbar_amateur_cup',
    name: '团结广场的网咖赛',
    icon: '🖥️',
    kind: 'choice',
    weight: 10,
    /*
     * 这个事件是**可重复**的：网咖赛每年春天都办。
     *
     * 原因：esports 那条线要求"去网吧刷够 3 次"，而一局里这个事件只演一次的话，
     * 事件往往在第 3 周就来了——那时候谁都不可能有 3 次网吧记录，
     * 等于这条结局永远打不开。让比赛一年一年地办下去，才是对的。
     * cooldown 拉到 10 周，免得同一个人一年被递两次名片。
     */
    once: false,
    cooldown: 10,
    text:
      '团结广场后巷那家网咖在门口贴了海报：周末业余赛，五人一队，赢一场送二十块网费。' +
      '老板叼着烟说，市里青训队的人偶尔会来看看，"打得好的，人家当场就递名片"。',
    choices: [
      {
        id: 'join_team',
        label: '报名组队，通宵排练',
        hint: '很爽；熬垮了会出事',
        outcome: '你们五个人在包间里练到凌晨三点，显示器发着蓝光，泡面汤结了皮。你从来没这么专注过。',
        effect: (game) => {
          /*
           * 青训队要的是"把别的都放下的人"。
           *
           * 门槛：**去网吧这个行动要刷够 3 次**，而且**六科平均分已经掉到 45 以下**。
           * 也就是说，这条好结局只对"真的把三年投在屏幕上"的玩法开放——
           * 随手打一次游戏就能靠电竞找出路，会让"读书"这条主线变得没意义。
           */
          const actionGames = game.history.filter((item) => item.action === 'game').length;
          const keys = game.subjectKeys ?? [];
          const average = keys.length ? keys.reduce((sum, key) => sum + (game.knowledge[key] ?? 0), 0) / keys.length : 100;
          const nights = (game.flags.netbarNights ?? 0) + 1;
          if (actionGames >= 3 && average <= 45) {
            return {
              text:
                '决赛那天包间里挤了二十多个人。决胜局你一个人顶住了对面的强开，屏幕上跳出胜利两个字的时候，' +
                '整间屋子都在喊。\n' +
                '散场时一个穿队服的人把你叫住，递来一张名片："我们青训缺人，暑假来试训。"',
              stats: { mood: 10, social: 5, fatigue: 8, comprehensive: -2 },
              npc: { parents: -3, head: -4 },
              flags: { netbarNights: nights, esportsRoute: true },
              ending: 'esports',
            };
          }
          return {
            stats: { mood: 5, social: 4, fatigue: 10 },
            flags: { netbarNights: nights },
            risk: [
              {
                // 通宵 + 状态差 = 直接倒下
                chance: game.stats.physique <= 40 || game.stats.mood <= 45 ? 0.45 : 0.18,
                text: '',
                effect: (inner) => {
                  if (inner.stats.physique <= 32) {
                    return {
                      text:
                        '第四局打到一半，你眼前突然一片白，耳机滑到了脖子上。\n' +
                        '再醒过来是在网咖的沙发上，老板拿着你的手机，屏幕上是"爸爸"的来电。' +
                        '回家以后你被按着去医院做了检查，医生说这是连续熬夜加低血糖，' +
                        '让你至少一个月别再碰通宵。',
                      stats: { physique: -18, mood: -10, fatigue: 12 },
                      npc: { parents: 5, head: -3 },
                      flags: { netbarCollapse: true },
                    };
                  }
                  return {
                    text:
                      '你们赢了两场输了一场，散场时天已经亮了。第二天上午的课你睡了整整两节，' +
                      '同桌帮你把老师的板书拍了下来。',
                    stats: { mood: -4, fatigue: 6 },
                    knowledge: { all: -0.5 },
                  };
                },
              },
            ],
          };
        },
      },
      {
        id: 'bet_match',
        label: '跟旁边的老哥赌一局',
        hint: '刺激，可能输钱',
        outcome: '你跟隔壁机的老哥solo了三局，赢了二十块网费，也收获了一个"下次再来"的约定。',
        effect: (game) => ({
          stats: { mood: 6, social: 2, fatigue: 4 },
          flags: { netbarBet: true },
          risk: [
            {
              chance: 0.45,
              text: '',
              effect: {
                text:
                  '三局你全输了，连网费加上赌注一共赔了一百多，还欠了老板两小时的机时。' +
                  '走出后巷的时候你摸了摸口袋，只剩两块钱，连公交都坐不了。',
                money: -120,
                stats: { mood: -8, fatigue: 2 },
              },
            },
          ],
        }),
      },
      {
        id: 'go_home_study',
        label: '收书包，回家做套卷子',
        hint: '稳，会被笑',
        outcome: '你背着书包走出网咖，晚风有点凉。回家做了套数学卷子，同桌在群里发了张他们赢了的截图。',
        effect: { stats: { discipline: -3, mood: -3, fatigue: -2 }, knowledge: { math: 1.6 }, npc: { deskmate: -2 } },
      },
    ],
  },
  {
    id: 'part_time_rebate_scam',
    name: '群里的刷单兼职',
    icon: '💳',
    kind: 'choice',
    weight: 9,
    /*
     * 只有手里真的紧的时候才会去点这种群消息。
     * 这条 cond 既符合文案（"零花钱刚好在上周花完了"），
     * 也把"钱多得花不完还去刷单"这种说不通的情况挡掉。
     */
    cond: (game) => (game.stats.money ?? 0) <= 600,
    text:
      '晚自习回家，班群里有人转发了一个兼职群。进去以后立刻有个"客服"加你，说在家动动手指就能日结，' +
      '还发了几张别人收到转账的截图。你的零花钱刚好在上周花完了。',
    choices: [
      {
        id: 'pay_deposit',
        label: '先垫三百，做完三单就收手',
        hint: '对方要你先垫钱，危险',
        outcome: '你按客服给的链接转了过去。前三单确实返了二十几块，第四单要垫八百。',
        effect: (game) => {
          // 越缺钱、越着急、越信"动动手指就能赚钱"，越容易把最后一笔也转出去
          const desperate = game.stats.intelligence <= 45 || game.stats.mood <= 38 || game.stats.money <= 50;
          return {
            money: -300,
            stats: { mood: -4, fatigue: 3 },
            flags: { rebateTried: true },
            risk: [
              {
                /*
                 * 上面那条 hint 已经把"要你先垫钱"写在脸上了，正常玩家会避开；
                 * 所以这里只惩罚"看懂了还去赌"的人，概率压到 0.6 / 0.25——
                 * 一局三年因为一次点错就直接结束，代价已经够重了。
                 */
                chance: desperate ? 0.6 : 0.25,
                text: '',
                effect: (inner) => ({
                  text:
                    '第四单转过去之后，"客服"说"系统卡单，需要再补一千二解冻"。你翻遍了所有口袋，' +
                    '把过年的红包也一起转了过去，然后被移出了群聊。\n' +
                    '那天晚上你坐在书桌前，把聊天记录从头翻到尾。你妈进来叫你睡觉，' +
                    '看见你的脸，什么都明白了。第二天你爸去了派出所，回来一句话没说，把烟盒捏扁了。',
                  money: -Math.max(0, Math.round(inner.stats.money)),
                  stats: { mood: -26, fatigue: 6 },
                  npc: { parents: -28, head: -4 },
                  flags: { scammed: true },
                  ending: 'scam',
                }),
              },
            ],
          };
        },
      },
      {
        id: 'ask_classmate',
        label: '先在群里问一句靠谱吗',
        hint: '稳，可能被踢出群',
        outcome: '你在群里问了句"这个是不是要垫钱"。三秒钟后你被移出了群聊，发帖的同学私聊你说"我也不知道"。',
        effect: {
          stats: { mood: 3, discipline: -2, social: 2, comprehensive: 1 },
          flags: { scamAvoided: true },
        },
      },
      {
        id: 'report_it',
        label: '截图举报，顺便提醒班里',
        hint: '稳，得罪发帖的人',
        outcome:
          '你把聊天记录截了图，举报了那个群，还在班群里说了句"别信这个"。有几个人回了"谢谢"，发帖的同学把你拉黑了。',
        effect: {
          stats: { discipline: -3, social: -2, mood: 4, comprehensive: 1 },
          npc: { head: 3 },
          flags: { scamAvoided: true, antiScamReport: true },
        },
      },
    ],
  },
];

/**
 * 校园日常成就。
 *
 * 格式跟引擎 `collectAchievements` 里手写的那一批一致：
 * 只要 `flag` 在这一局的 `game.flags` 里为真，结局结算时就会收录。
 */
export const CAMPUS_ACHIEVEMENTS = [
  { flag: 'broadcastStar', icon: '🎙️', name: '校园广播员', desc: '午休的十分钟，整栋楼都在听你说话' },
  { flag: 'broadcastBlunder', icon: '📢', name: '念错了名字', desc: '全校都听见你把同桌念成了隔壁班' },
  { flag: 'deskCarving', icon: '✏️', name: '课桌考古学家', desc: '在一张旧课桌上留下了自己的年份' },
  { flag: 'dutyHero', icon: '🧹', name: '最后一个锁门的人', desc: '一个人擦完黑板、倒完垃圾、拖完走廊' },
  { flag: 'putangReached', icon: '🎋', name: '濮塘登顶', desc: '推着车爬完了那段没有台阶的野路' },
  { flag: 'noodleRegular', icon: '🍜', name: '老市里加牛肉', desc: '面馆老板记住了你要加蛋加肉' },
  { flag: 'buzzCut', icon: '✂️', name: '健康路寸头', desc: '推子响完，镜子里的人有点陌生' },
  { flag: 'pushedEbike', icon: '🛵', name: '推车四公里', desc: '两袋米一箱奶，一路推回了家' },
  { flag: 'madeDumplings', icon: '🥟', name: '年夜饭二厨', desc: '包了三只漏馅的饺子，你爸全吃了' },
  { flag: 'apologyMade', icon: '🤝', name: '先低头的人', desc: '把新笔放在桌子中间，然后说了对不起' },
  { flag: 'oldFriendMeal', icon: '🍻', name: '初中的那顿饭', desc: '坐公交穿过半个城，就为聊两小时初中' },
  { flag: 'toldParentsTruth', icon: '📞', name: '报忧的孩子', desc: '模考掉了六十名，你还是照实说了' },
  { flag: 'volunteerLocked', icon: '🎯', name: '志愿表定稿', desc: '六个格子填完，三年就剩最后一笔' },
  { flag: 'momMidnightSoup', icon: '🥛', name: '门缝里的那碗牛奶', desc: '凌晨一点，杯子还是温的' },
  { flag: 'quitShortVideo', icon: '📵', name: '卸载了短视频', desc: '当着室友的面点了卸载，然后手痒了一整周' },
  { flag: 'esportsRoute', icon: '🎮', name: '青训试训生', desc: '网吧赛打到底，有人递来了名片' },
  { flag: 'scamAvoided', icon: '🛡️', name: '反诈课代表', desc: '在群里问了那一句"要垫钱吗"' },
];
