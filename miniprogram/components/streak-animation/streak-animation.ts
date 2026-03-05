// streak-animation.ts
Component<IComponentOptions>({
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
    particles: [] as any[]
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
      const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD']
      for (let i = 0; i < 50; i++) {
        particles.push({
          id: i,
          color: colors[Math.floor(Math.random() * colors.length)],
          delay: Math.random() * 0.5,
          duration: 1.5 + Math.random() * 1,
          left: Math.random() * 100,
          size: 8 + Math.random() * 12,
          rotate: Math.random() * 360
        })
      }
      this.setData({ particles })
    },

    playAnimation() {
      // 重置状态
      this.setData({
        showConfetti: false,
        showFlame: false,
        showStreakNumber: false,
        showSparkles: false
      })

      // 延迟开始动画
      setTimeout(() => {
        this.setData({
          showConfetti: true,
          showFlame: true
        })
      }, 50)

      // 第0.3秒显示连胜数字
      setTimeout(() => {
        this.setData({ showStreakNumber: true })
      }, 300)

      // 第0.5秒显示星星闪烁
      setTimeout(() => {
        this.setData({ showSparkles: true })
      }, 500)

      // 第2.5秒动画完成
      setTimeout(() => {
        this.triggerEvent('complete')
      }, 2500)
    },

    onAnimationEnd() {
      this.triggerEvent('complete')
    },

    // 阻止点击穿透
    preventTap() {}
  }
})
