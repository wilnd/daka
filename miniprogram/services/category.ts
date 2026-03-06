/**
 * 记录类别配置
 */

/** 记录大类 */
export interface Category {
  id: string
  name: string
  /** 小类列表 */
  subCategories: SubCategory[]
}

/** 记录小类 */
export interface SubCategory {
  id: string
  name: string
}

/** 记录类别配置 */
export const CHECKIN_CATEGORIES: Category[] = [
  {
    id: 'sports',
    name: '运动类',
    subCategories: [
      { id: 'running', name: '跑步' },
      { id: 'walking', name: '走路' },
      { id: 'cycling', name: '骑行' },
      { id: 'swimming', name: '游泳' },
      { id: 'fitness', name: '健身' },
      { id: 'yoga', name: '瑜伽' },
      { id: 'basketball', name: '篮球' },
      { id: 'football', name: '足球' },
      { id: 'tennis', name: '网球' },
      { id: 'badminton', name: '羽毛球' },
      { id: 'pingpong', name: '乒乓球' },
      { id: 'dance', name: '舞蹈' },
      { id: 'hiking', name: '徒步' },
      { id: 'climbing', name: '攀岩' },
      { id: 'other_sports', name: '其他' }
    ]
  },
  {
    id: 'study',
    name: '学习类',
    subCategories: [
      { id: 'reading', name: '阅读' },
      { id: 'writing', name: '写作' },
      { id: 'language', name: '语言学习' },
      { id: 'programming', name: '编程' },
      { id: 'music', name: '音乐' },
      { id: 'art', name: '美术' },
      { id: 'chess', name: '棋类' },
      { id: 'other_study', name: '其他' }
    ]
  },
  {
    id: 'life',
    name: '生活类',
    subCategories: [
      { id: 'diet', name: '饮食记录' },
      { id: 'sleep', name: '睡眠' },
      { id: 'meditation', name: '冥想' },
      { id: 'habit', name: '习惯养成' },
      { id: 'other_life', name: '其他' }
    ]
  }
]

/** 获取大类列表 */
export function getCategories(): Category[] {
  return CHECKIN_CATEGORIES
}

/** 根据大类ID获取小类列表 */
export function getSubCategories(categoryId: string): SubCategory[] {
  const category = CHECKIN_CATEGORIES.find(c => c.id === categoryId)
  return category ? category.subCategories : []
}

/** 获取大类名称 */
export function getCategoryName(categoryId: string): string {
  const category = CHECKIN_CATEGORIES.find(c => c.id === categoryId)
  return category ? category.name : ''
}

/** 获取小类名称 */
export function getSubCategoryName(categoryId: string, subCategoryId: string): string {
  const subCategories = getSubCategories(categoryId)
  const subCategory = subCategories.find(s => s.id === subCategoryId)
  return subCategory ? subCategory.name : ''
}

/** 根据ID获取类别显示名称（优先显示小类名称，如果没有则显示大类） */
export function getCategoryDisplayName(categoryId: string, subCategoryId: string): string {
  if (subCategoryId) {
    // 先尝试根据 categoryId 找到对应的大类，再找小类
    if (categoryId) {
      const subName = getSubCategoryName(categoryId, subCategoryId)
      if (subName) return subName
    }
    // 如果没有 categoryId，遍历所有大类找小类
    for (const cat of CHECKIN_CATEGORIES) {
      const sub = cat.subCategories.find(s => s.id === subCategoryId)
      if (sub) return sub.name
    }
  }
  if (categoryId) {
    return getCategoryName(categoryId)
  }
  return ''
}

/** 根据类别ID获取类别信息 */
export function getCategoryById(categoryId: string): Category | undefined {
  return CHECKIN_CATEGORIES.find(c => c.id === categoryId)
}

/** 根据小类ID获取完整类别信息（包含大类名称） */
export function getCategoryInfoBySubCategoryId(subCategoryId: string): { categoryName: string; subCategoryName: string } | null {
  for (const cat of CHECKIN_CATEGORIES) {
    const sub = cat.subCategories.find(s => s.id === subCategoryId)
    if (sub) {
      return {
        categoryName: cat.name,
        subCategoryName: sub.name
      }
    }
  }
  return null
}
