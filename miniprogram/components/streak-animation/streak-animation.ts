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
    particles: [] as any[],
    displayStreak: 0,  // 用于数字滚动效果
    badge: null as any,  // 当前徽章
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
      const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#FF9F43', '#00D2D3']
      for (let i = 0; i < 80; i++) {
        particles.push({
          id: i,
          color: colors[Math.floor(Math.random() * colors.length)],
          delay: Math.random() * 0.8,
          duration: 1.5 + Math.random() * 1.5,
          left: Math.random() * 100,
          size: 6 + Math.random() * 14,
          rotate: Math.random() * 360,
          opacity: 0.6 + Math.random() * 0.4
        })
      }
      this.setData({ particles })
    },

    // 根据连胜天数获取徽章
    getBadge(streak: number) {
      if (streak >= 100) {
        return { name: '传奇王者', icon: '👑', color: '#FFD700', level: 'legendary' }
      } else if (streak >= 30) {
        return { name: '运动大师', icon: '🏆', color: '#FF6B6B', level: 'master' }
      } else if (streak >= 14) {
        return { name: '坚持达人', icon: '💪', color: '#4ECDC4', level: 'expert' }
      } else if (streak >= 7) {
        return { name: '运动新星', icon: '⭐', color: '#45B7D1', level: 'star' }
      } else if (streak >= 3) {
        return { name: '初学者', icon: '🌱', color: '#96CEB4', level: 'beginner' }
      } else {
        return { name: '刚起步', icon: '🎯', color: '#FFEAA7', level: 'starter' }
      }
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
      const { streak, animationDuration } = this.properties as any
      
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
        const badge = this.getBadge(streak)
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
        displayStreak: (this.properties as any).streak
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
