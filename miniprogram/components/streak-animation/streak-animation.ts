// streak-animation.ts
Component({
  options: {
    styleIsolation: 'shared'
  },

  properties: {
    streak: {
      type: Number,
      value: 0
    },
    visible: {
      type: Boolean,
      value: false
    },
    categoryId: {
      type: String,
      value: 'sports'
    },
    animationComplete: {
      type: Boolean,
      value: false
    }
  },

  data: {
    showConfetti: false,
    showFlame: false,
    showStreakNumber: false,
    showSparkles: false,
    showBadge: false,
    showMessage: false,
    particles: [],
    displayStreak: 0,  // 用于数字滚动效果
    badge: null,  // 当前徽章
    canSkip: false,  // 是否可以跳过
    animationDuration: 3000  // 动画总时长
  },

  lifetimes: {
    attached() {
      this.createParticles()
    }
  },

  observers: {
    'visible': function(visible: boolean) {
      if (visible) {
        this.playAnimation()
      }
    }
  },

  methods: {
    createParticles() {
      const particles = []
      // 热烈风格：以红橙金为主，点缀亮黄和白
      const colors = [
        '#FFD700', '#FF8C00', '#FF4500', '#FF6B00',
        '#FFB300', '#FF2200', '#FFEE00', '#FF9900',
        '#FFFFFF', '#FFF0A0'
      ]
      for (let i = 0; i < 90; i++) {
        particles.push({
          id: i,
          color: colors[Math.floor(Math.random() * colors.length)],
          delay: Math.random() * 0.9,
          duration: 1.4 + Math.random() * 1.6,
          left: Math.random() * 100,
          size: 6 + Math.random() * 16,
          rotate: Math.random() * 360,
          opacity: 0.7 + Math.random() * 0.3
        })
      }
      this.setData({ particles })
    },

    // 根据连胜天数 + 打卡类别获取徽章
    getBadge(streak: number, categoryId: string) {
      const config: Record<string, { badges: Array<{ min: number; name: string; icon: string; color: string }> }> = {
        sports: {
          badges: [
            { min: 100, name: '传奇王者', icon: '👑', color: '#FFD700' },
            { min: 30,  name: '运动大师', icon: '🏆', color: '#FF6B00' },
            { min: 14,  name: '健身达人', icon: '💪', color: '#FF4500' },
            { min: 7,   name: '运动新星', icon: '🔥', color: '#FF8C00' },
            { min: 3,   name: '活力初探', icon: '⚡', color: '#FFB300' },
            { min: 0,   name: '起跑线上', icon: '🎽', color: '#FFEE00' },
          ]
        },
        study: {
          badges: [
            { min: 100, name: '学海无涯', icon: '👑', color: '#FFD700' },
            { min: 30,  name: '博学大师', icon: '🎓', color: '#FF6B00' },
            { min: 14,  name: '知识达人', icon: '📚', color: '#FF4500' },
            { min: 7,   name: '学习之星', icon: '🌟', color: '#FF8C00' },
            { min: 3,   name: '求知新芽', icon: '✏️', color: '#FFB300' },
            { min: 0,   name: '学习出发', icon: '🔍', color: '#FFEE00' },
          ]
        },
        life: {
          badges: [
            { min: 100, name: '生活传奇', icon: '👑', color: '#FFD700' },
            { min: 30,  name: '生活大师', icon: '🏅', color: '#FF6B00' },
            { min: 14,  name: '生活达人', icon: '🌈', color: '#FF4500' },
            { min: 7,   name: '习惯之星', icon: '⭐', color: '#FF8C00' },
            { min: 3,   name: '生活新芽', icon: '🌱', color: '#FFB300' },
            { min: 0,   name: '好生活启程', icon: '🎯', color: '#FFEE00' },
          ]
        }
      }
      const cat = config[categoryId] || config['sports']
      const match = cat.badges.find(b => streak >= b.min) || cat.badges[cat.badges.length - 1]
      return { ...match, level: match.name }
    },

    // 数字滚动动画
    animateNumber(start: number, end: number, duration: number) {
      const startTime = Date.now()
      const diff = end - start

      const step = () => {
        const now = Date.now()
        const progress = Math.min((now - startTime) / duration, 1)

        // 使用缓动函数
        const easeProgress = 1 - Math.pow(1 - progress, 3)
        const currentValue = Math.round(start + diff * easeProgress)

        this.setData({ displayStreak: currentValue })

        if (progress < 1) {
          setTimeout(step, 16)
        }
      }

      setTimeout(step, 16)
    },

    playAnimation() {
      const streak = this.properties.streak as number
      const animationDuration = this.properties.animationDuration as number
      
      // 重置状态
      this.setData({
        showConfetti: false,
        showFlame: false,
        showStreakNumber: false,
        showSparkles: false,
        showBadge: false,
        showMessage: false,
        displayStreak: 0,
        canSkip: false
      })

      // 计算各阶段时长
      const confettiDelay = 50
      const numberDelay = 300
      const badgeDelay = 800
      const messageDelay = 1500
      const endDelay = animationDuration

      // 立即开始纸屑动画
      setTimeout(() => {
        this.setData({ showConfetti: true })
      }, confettiDelay)

      // 第0.3秒显示火焰和开始数字滚动
      setTimeout(() => {
        this.setData({ showFlame: true, showStreakNumber: true })
        // 数字从0滚动到目标值
        this.animateNumber(0, streak, 600)
      }, numberDelay)

      // 第0.8秒显示徽章
      setTimeout(() => {
        const categoryId = this.properties.categoryId as string
        const badge = this.getBadge(streak, categoryId || 'sports')
        this.setData({ 
          showBadge: true,
          badge
        })
      }, badgeDelay)

      // 第1.5秒显示星星闪烁
      setTimeout(() => {
        this.setData({ showSparkles: true })
      }, messageDelay - 500)

      // 第1.5秒显示提示文字
      setTimeout(() => {
        this.setData({ showMessage: true })
      }, messageDelay)

      // 显示跳过按钮
      setTimeout(() => {
        this.setData({ canSkip: true })
      }, messageDelay + 500)

      // 动画完成
      setTimeout(() => {
        this.triggerEvent('complete')
      }, endDelay)
    },

    // 跳过动画
    onSkip() {
      this.setData({ 
        canSkip: false,
        showConfetti: false,
        showFlame: false,
        showStreakNumber: false,
        showSparkles: false,
        showBadge: false,
        showMessage: false,
        displayStreak: this.properties.streak as number
      })
      this.triggerEvent('skip')
      this.triggerEvent('complete')
    },

    onAnimationEnd() {
      this.triggerEvent('complete')
    },

    // 阻止点击穿透
    preventTap() {}
  }
})
