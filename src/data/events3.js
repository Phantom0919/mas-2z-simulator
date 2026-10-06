/**
 * 第三批随机事件：**按校历发生的事**。
 *
 * 这一批全部是"什么时候该发生什么"写得比较实的事件——
 * 军训、开学典礼、中秋发月饼、艺术节、科技周、成人礼、高考体检、毕业照……
 * 它们的时间约束统一登记在 `src/data/calendar.js` 的 EVENT_SCHEDULE 里，
 * 所以不会出现"五月办元旦晚会"这种事。
 *
 * 格式和 events.js 完全一致；`cond` 只用来表达数值条件，时间条件一律走日历表。
 */

export const SEASONAL_EVENTS = [
  {
    id: 'military_training',
    name: '军训',
    icon: '🎖️',
    kind: 'choice',
    weight: 14,
    text:
      '八月底的太阳把操场晒得发白。你们穿着刚发下来的迷彩服站军姿，站到第十分钟就有人晃。' +
      '教官从队伍前面走过来，在你面前停了一下——你的领口没扣。',
    choices: [
      {
        id: 'fix',
        label: '赶紧把扣子扣上',
        hint: '老实但没面子',
        outcome:
          '你手忙脚乱地扣上，教官盯了你两秒，走了。旁边的人憋笑憋得肩膀直抖。' +
          '那天下午你是全班站得最直的那个。',
        effect: { stats: { physique: 4, discipline: -3, mood: -1 } },
      },
      {
        id: 'stand',
        label: '不管，继续站',
        hint: '赌教官没看见',
        outcome:
          '"出列。"教官的声音不大，但整个方阵都听见了。你单独站了十分钟，汗顺着下巴滴到鞋面上。' +
          '不过那十分钟之后，你发现自己居然不觉得累了。',
        effect: { stats: { physique: 6, mood: -3, social: 2 } },
      },
      {
        id: 'joke',
        label: '小声跟教官开玩笑',
        hint: '胆大，可能挨骂也可能圈粉',
        outcome:
          '教官愣了一下，居然笑了："行，你嗓门大，你来喊口号。"你喊了一下午，嗓子哑了，' +
          '但全班都记住了你。',
        effect: { stats: { social: 7, physique: 2, mood: 2, fatigue: 3 } },
      },
    ],
  },
  {
    id: 'opening_ceremony',
    name: '开学典礼',
    icon: '🏫',
    kind: 'auto',
    weight: 9,
    text:
      '开学典礼在操场上开。校长讲了四十分钟，从"厚德励学敦行"讲到去年的高考成绩，' +
      '太阳从旗杆这边挪到了那边。你站在队伍里，悄悄把重心从左脚换到右脚。',
    effect: { stats: { comprehensive: 2, fatigue: 2, mood: -1 } },
  },
  {
    id: 'mid_autumn_mooncake',
    name: '中秋节的月饼',
    icon: '🥮',
    kind: 'choice',
    weight: 10,
    text:
      '中秋前一天，学校给每人发了两块月饼，豆沙的和五仁的。' +
      '班里立刻分成两派：抢五仁的和躲五仁的。你手上正好是五仁。',
    choices: [
      {
        id: 'trade',
        label: '拿五仁跟人换豆沙',
        hint: '社交 +',
        outcome: '你用五仁换到了两块豆沙，代价是帮对方值日一周。这笔买卖你觉得不亏。',
        effect: { stats: { social: 3, mood: 3 } },
      },
      {
        id: 'eat',
        label: '自己吃掉，五仁也挺香',
        hint: '不折腾',
        outcome: '你把五仁月饼吃了，还认真分辨了一下里面到底有几种果仁。同桌看你的眼神像在看外星人。',
        effect: { stats: { mood: 2, comprehensive: 1 } },
      },
      {
        id: 'home',
        label: '两块都留着，带回家给爸妈',
        hint: '父母关系 +',
        outcome:
          '晚上你把两块月饼放在饭桌上。妈妈说"你吃吧"，爸爸直接掰了一半塞进嘴里。' +
          '两块月饼，三个人分。',
        effect: { npc: { parents: 8 }, stats: { mood: 4 } },
      },
    ],
  },
  {
    id: 'art_festival',
    name: '校园艺术节',
    icon: '🎭',
    kind: 'choice',
    weight: 11,
    text:
      '艺术节在操场东边搭了台子，一个班出两个节目。班里的文艺委员拿着报名表站在你桌前，' +
      '"就你了，你上次班会唱得挺好。"',
    choices: [
      {
        id: 'sing',
        label: '上台唱一首',
        hint: '综合素质 +，可能翻车',
        outcome:
          '你唱到第二段的时候话筒突然没声了，清唱完最后半分钟。台下亮起一片手机的手电筒，' +
          '有人跟着哼。谢幕时你听见最前排喊你们班的名字。',
        effect: { stats: { comprehensive: 8, social: 6, mood: 5, fatigue: 2 } },
      },
      {
        id: 'backstage',
        label: '去后台帮忙搬道具',
        hint: '稳一点',
        outcome: '你搬了一下午音箱，累得够呛，但整场演出你都从幕布缝里看得清清楚楚。',
        effect: { stats: { comprehensive: 4, social: 3, fatigue: 3 } },
      },
      {
        id: 'study',
        label: '在教室写作业',
        hint: '学习 +，社交 -',
        outcome:
          '教学楼里安静得能听见操场传来的音响声。你写完了两套卷子，抬头时演出已经结束了。' +
          '走廊上有人抱着道具回来，笑声一路传过来。',
        effect: { knowledge: { all: 0.8 }, stats: { social: -4, mood: -2 } },
      },
    ],
  },
  {
    id: 'science_week',
    name: '科技活动周',
    icon: '🚀',
    kind: 'choice',
    weight: 9,
    text:
      '科技周的水火箭比赛在操场角落进行，物理老师在旁边记时间。' +
      '你们班的水火箭是用雪碧瓶和胶带做的，看起来有点悬。',
    choices: [
      {
        id: 'launch',
        label: '自己上手打气发射',
        hint: '物理知识 +，可能湿身',
        outcome:
          '你打到第八下，瓶子"砰"地蹿了出去，落在跑道另一边。全班欢呼的时候，' +
          '喷出来的水把你浇了半身。物理老师在本子上写了个不错的成绩。',
        effect: { knowledge: { physics: 2.5, all: 0.3 }, stats: { comprehensive: 5, mood: 4, social: 3 } },
      },
      {
        id: 'design',
        label: '留在教室改设计图',
        hint: '综合素质 +',
        outcome: '你把尾翼的角度重画了三遍，最后那一版被贴在实验室的墙上当示范。',
        effect: { stats: { comprehensive: 6, intelligence: 2, fatigue: 2 }, knowledge: { physics: 1.2 } },
      },
    ],
  },
  {
    id: 'adult_ceremony',
    name: '成人礼',
    icon: '🕯️',
    kind: 'choice',
    weight: 12,
    text:
      '成人礼在操场上办，要求穿正装，还要给家长写一封信。' +
      '你趴在桌上写了三遍：第一遍太肉麻，第二遍太敷衍，第三遍写了半页就写不下去了。',
    choices: [
      {
        id: 'write',
        label: '把信写完，当面交给爸妈',
        hint: '父母关系大涨',
        outcome:
          '你妈接过信的时候说"哎呀还写信"，然后站在操场边上从头看到尾，中间抬手擦了一下眼睛。' +
          '你爸什么都没说，只是把信折好放进了上衣口袋。',
        effect: { npc: { parents: 14 }, stats: { mood: 8, comprehensive: 4 } },
      },
      {
        id: 'short',
        label: '只写一句"我会努力的"',
        hint: '安全牌',
        outcome: '你把那张纸交上去，心里有点虚。妈妈看了一眼，说："知道了。"然后给你夹了一筷子菜。',
        effect: { npc: { parents: 4 }, stats: { mood: 2 } },
      },
      {
        id: 'skip',
        label: '信没写，只跟着走了过场',
        hint: '什么都没发生',
        outcome:
          '你跟着队伍走过成人门，拍照的时候笑了一下。晚上回家，妈妈问"今天成人礼怎么样"，' +
          '你说了句"还行"。',
        effect: { stats: { mood: -2 } },
      },
    ],
  },
  {
    id: 'gaokao_physical',
    name: '高考体检',
    icon: '🩺',
    kind: 'auto',
    weight: 12,
    text:
      '体检安排在妇幼保健医院，一整个上午。测视力的时候医生问"平时戴眼镜吗"，' +
      '抽血的时候你转过头不敢看。体检表上写满了你看不懂的缩写，最后盖章：合格。',
    effect: { stats: { mood: -1, fatigue: 3 } },
  },
  {
    id: 'graduation_photo',
    name: '毕业照',
    icon: '📷',
    kind: 'choice',
    weight: 16,
    text:
      '拍毕业照那天，全体穿校服，在操场上站成三排。摄影师喊"看这里——三、二、一"，' +
      '然后说"再来一张，刚才有人眨眼"。拍完大家都不肯走。',
    choices: [
      {
        id: 'friend',
        label: '拉着同学单独多拍几张',
        hint: '友情线',
        outcome:
          '你们在榆树下拍了十几张，姿势越来越奇怪。最后一张是所有人跳起来的，' +
          '照片里没一个完整的脸。',
        effect: { npc: { deskmate: 10, friend: 10 }, stats: { mood: 6, social: 3 } },
      },
      {
        id: 'teacher',
        label: '去找班主任合影',
        hint: '老师好感 +',
        outcome:
          '班主任站在台阶上，被你叫住的时候愣了一下，然后很自然地整理了一下衣服。' +
          '"站好，别缩着。"她说。照片里她笑得比平时松。',
        effect: { npc: { head: 10 }, stats: { mood: 4, comprehensive: 3 } },
      },
      {
        id: 'quiet',
        label: '一个人绕着操场走一圈',
        hint: '心情 +',
        outcome:
          '你沿着跑道慢慢走了一圈，经过篮球场、器材室、那棵被刻满字的梧桐树。' +
          '走到起点的时候，你发现自己把这三年的路又走了一遍。',
        effect: { stats: { mood: 8, fatigue: -3 } },
      },
    ],
  },
  {
    id: 'flag_ceremony',
    name: '升旗仪式',
    icon: '🇨🇳',
    kind: 'auto',
    weight: 8,
    text:
      '周一早上的升旗仪式，全体在操场集合。国歌响起来的时候，隔壁班还是有人在偷偷背单词。' +
      '你在队伍里站着，忽然觉得这样的早晨还剩下几十个。',
    effect: { stats: { comprehensive: 1.5, mood: 1 } },
  },
  {
    id: 'mahgang_visit',
    name: '社会实践：参观马钢',
    icon: '🏭',
    kind: 'auto',
    weight: 9,
    text:
      '社会实践去参观马钢。高炉的温度隔着几十米都能感觉到，讲解员说这里的钢轨铺到了全国一半的高铁上。' +
      '你忽然想到，自己每天路过的那片灰白色的天，原来是这么来的。',
    effect: { stats: { comprehensive: 6, mood: 2, fatigue: 2 } },
  },
  {
    id: 'rainy_pe_class',
    name: '雨天的体育课',
    icon: '🌧️',
    kind: 'choice',
    weight: 9,
    text:
      '体育课赶上下雨，全班挤在体育馆里。老师放了半节课的羊，' +
      '有人打羽毛球，有人靠着墙玩手机，还有人从书包里掏出了卷子。',
    choices: [
      {
        id: 'play',
        label: '打一场羽毛球',
        hint: '体质 +',
        outcome: '你和同桌打了一节课，出了一身汗。回教室的路上，雨刚好停了。',
        effect: { stats: { physique: 4, social: 2, mood: 3, fatigue: 2 } },
      },
      {
        id: 'homework',
        label: '靠墙把今天的卷子写完',
        hint: '学习 +，社交 -',
        outcome: '体育馆里全是回声和笑声，你写完了整张卷子。抬头的时候发现旁边围了三个同学在看你最后一道大题。',
        effect: { knowledge: { all: 0.6 }, stats: { social: 2, mood: -1, fatigue: 1 } },
      },
      {
        id: 'chat',
        label: '跟人聊天',
        hint: '社交 +',
        outcome: '你听完了隔壁班半年的八卦，也在别人嘴里听到了自己的名字——原来有人一直觉得你挺厉害。',
        effect: { stats: { social: 6, mood: 4, comprehensive: 2 } },
      },
    ],
  },
];
