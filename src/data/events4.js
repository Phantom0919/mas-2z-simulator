/**
 * 第四批随机事件：**抽象事件**。
 *
 * 这一批是玩家点名的"离谱结局"来源——吃路边摊吃出急性肠胃炎、雨山湖划船掉水里、
 * 高考前夜通宵然后睡过头。共同点是：平时只是掉点状态，**状态太差的时候会直接把这一局送进结局**。
 *
 * 触发结局靠的是 effect 里的 `ending` 字段（引擎的 applyEffects 支持），
 * 所以这里不用写任何特殊逻辑，条件判断直接写在 effect 函数里。
 *
 * 时间约束统一登记在 `src/data/calendar.js`。
 */

export const ABSTRACT_EVENTS = [
  {
    id: 'street_stall',
    name: '校门口的路边摊',
    icon: '🍢',
    kind: 'choice',
    weight: 12,
    text:
      '晚自习下课，校门口那家没有招牌的炸串摊前排了七八个人。铁板上的油滋啦作响，' +
      '老板用同一把夹子夹生肉和熟串，风把孜然吹了你一脸。',
    choices: [
      {
        id: 'eat',
        label: '来十串，多加辣',
        hint: '很爽，但油和肉都不太新鲜——体质差容易出事',
        outcome: '你站在马路牙子上吃完了十串，辣得眼泪都出来了。这是这周最痛快的十五分钟。',
        effect: (game) => ({
          money: -14,
          stats: { mood: 7, fatigue: -2 },
          risk: [
            {
              // 体质越差越容易中招
              chance: game.stats.physique < 45 ? 0.55 : 0.3,
              text: '',
              effect: (inner) => {
                if (inner.stats.physique <= 34) {
                  return {
                    text:
                      '半夜两点，你被肚子疼醒。跑厕所跑到第四次的时候，你已经站不起来了，' +
                      '冷汗把睡衣溻透了。爸妈连夜把你送进人民医院，医生按了按你的肚子：' +
                      '"急性肠胃炎，脱水了，先输液。"\n' +
                      '三天后你才出院，人瘦了一圈。班主任在班会上说了一句"外面的东西少吃"，' +
                      '全班都回头看你。',
                    stats: { physique: -30, mood: -12, fatigue: 20 },
                    npc: { parents: 8 },
                    flags: { stomachBug: true },
                    ending: 'food_poison',
                  };
                }
                return {
                  text:
                    '后半夜你跑了三趟厕所，第二天上课一直趴在桌上。中午喝了两碗白粥才缓过来。' +
                    '你在心里发誓以后再也不吃那家了——大概能坚持到下周一。',
                  stats: { physique: -7, mood: -4, fatigue: 8 },
                  flags: { stomachBug: true },
                };
              },
            },
          ],
        }),
      },
      {
        id: 'watch',
        label: '看看就好，买瓶水',
        hint: '稳',
        outcome: '你买了两块钱的矿泉水，站在旁边看别人吃。回宿舍的路上你觉得自己挺成熟。',
        effect: { money: -2, stats: { mood: 2, comprehensive: 1 } },
      },
      {
        id: 'treat',
        label: '请同桌一起吃，你付钱',
        hint: '花钱换关系',
        outcome: (game) =>
          `你一口气点了三十串。${game.cast?.map?.deskmate?.call ?? '同桌'}吃得满手是油，` +
          `说"你这个人不错"。这顿花了你四十多块。`,
        effect: { money: -46, stats: { social: 6, mood: 8 }, npc: { deskmate: 8 } },
      },
    ],
  },
  {
    id: 'yushanhu_boat',
    name: '雨山湖划船',
    icon: '🛶',
    kind: 'choice',
    weight: 11,
    text:
      '周末的雨山湖边全是人。脚踏船一小时三十块，码头上排着队。' +
      '同学已经跨上了船，回头喊你："快点，一会儿太阳就下去了！"',
    choices: [
      {
        id: 'board',
        label: '上船，往湖心划',
        hint: '很爽；船旧，体质差的人站上去会翻',
        outcome: '你们把船蹬到湖心，风从水面上过来，整片湖都是金色的。同学站起来拍照。',
        effect: (game) => ({
          money: -30,
          stats: { mood: 9, fatigue: -3, social: 3 },
          risk: [
            {
              chance: 0.22,
              text: '',
              // 体质差 + 站起来乱晃 = 直接落水
              effect: (inner) => {
                if (inner.stats.physique <= 38) {
                  return {
                    text:
                      '船身猛地一歪。你只来得及听见同学喊了半声，人就下去了。\n' +
                      '湖水比你想的冷得多，脚下全是水草，你抓了两把都是滑的。' +
                      '再睁眼是在人民医院的病床上，医生说是呛水引起的吸入性肺炎，' +
                      '加上你本来体质就差，得住一阵子。\n' +
                      '出院那天，妈妈把你那件泡过水的校服扔了。',
                    stats: { physique: -28, mood: -14, fatigue: 22 },
                    npc: { parents: 6 },
                    flags: { fellInLake: true },
                    ending: 'lake_fall',
                  };
                }
                return {
                  text:
                    '船身猛地一歪，你半个身子探进水里，被同学一把拽了回来。' +
                    '两个人趴在船上笑了半天，然后发现船桨掉了一只。' +
                    '最后是码头的师傅用竹竿把你们捞回去的。',
                  stats: { mood: -5, physique: -3, fatigue: 6 },
                  flags: { fellInLake: true },
                };
              },
            },
          ],
        }),
      },
      {
        id: 'lakeside',
        label: '岸边坐着，看他们划',
        hint: '安全，但会被笑',
        outcome: '你在岸边的长椅上坐了一个小时，看完了一整篇英语阅读。同学回来的时候说你"真没意思"。',
        effect: { stats: { social: -2, comprehensive: 1 }, knowledge: { all: 0.3 } },
      },
      {
        id: 'walk',
        label: '不划了，绕着湖走一圈',
        hint: '心情 +',
        outcome: '你沿着湖走了一整圈，走到腿酸。风一直吹着，什么也没想，挺好的。',
        effect: { stats: { mood: 6, physique: 2, fatigue: -2 } },
      },
    ],
  },
  {
    id: 'gaokao_eve_allnighter',
    name: '高考前夜',
    icon: '🌙',
    kind: 'choice',
    weight: 30,
    text:
      '高考前一天晚上，你的房间灯亮到十一点。桌上摊着错题本和一张还没背完的答题模板。' +
      '你已经困了，但总觉得"再看一页"。',
    choices: [
      {
        id: 'sleep',
        label: '合上书，去睡觉',
        hint: '稳妥',
        outcome:
          '你把错题本扣在桌上，关灯。躺下的时候心跳有点快，但二十分钟后你还是睡着了。\n' +
          '第二天早上六点自然醒，脑子是清的。',
        effect: { stats: { mood: 6, fatigue: -10 } },
      },
      {
        id: 'review',
        label: '再看一小时，就一小时',
        hint: '可能有用，可能过头',
        outcome: '你把答题模板又过了两遍，躺下的时候快十二点半，但心里踏实了一点。',
        effect: { stats: { fatigue: 6, mood: -1 }, knowledge: { all: 0.6 } },
      },
      {
        id: 'allnight',
        label: '干脆通宵，把三年再过一遍',
        hint: '知识涨得多，但可能第二天醒不过来',
        outcome: '你泡了杯浓咖啡，把六科的错题本从第一页翻到最后一页。窗外天慢慢亮了。',
        effect: (game) => ({
          stats: { fatigue: 22, mood: -6 },
          knowledge: { all: 1.6 },
          risk: [
            {
              chance: 0.3,
              text: '',
              effect: (inner) => {
                // 通宵之后睡死过去——体质差/心情差的人更容易起不来
                if (inner.stats.physique <= 45 || inner.stats.mood <= 40) {
                  return {
                    text:
                      '你睡得很沉，沉到手机闹钟响了六遍都没听见。\n' +
                      '妈妈以为你早就起了，出门前还替你关上了房门。等你睁开眼，' +
                      '墙上挂钟的指针已经越过了八点半——第一科语文，九点开考，考场在城东。\n' +
                      '你在出租车上哭了一路。到了考点，语文已经开考四十五分钟，按规定不能进场。\n' +
                      '三个小时后，你坐在马路牙子上，看着别人的家长把考生接走。' +
                      '这一局，到这儿就结束了。',
                    stats: { mood: -30, fatigue: -6 },
                    npc: { parents: 5 },
                    flags: { missedGaokao: true },
                    ending: 'late_for_gaokao',
                  };
                }
                return {
                  text:
                    '闹钟响的时候你几乎是从床上弹起来的，抓了准考证就往外跑。' +
                    '到考场时还剩十二分钟，你站在走廊上喘气，手心全是汗，' +
                    '但你好歹坐进了考场。',
                  stats: { mood: -8, fatigue: 10 },
                  flags: { closeCallGaokao: true },
                };
              },
            },
          ],
        }),
      },
    ],
  },
];
