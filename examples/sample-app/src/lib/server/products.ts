export interface Product {
  id: string
  name: string
  price: number
  category: 'coffee' | 'tea' | 'sweets'
  stock: number
  description: string
}

export const products: Product[] = [
  {
    id: 'p-001',
    name: 'Ethiopia Yirgacheffe',
    price: 1800,
    category: 'coffee',
    stock: 24,
    description: 'フローラルでシトラスの香りが特徴のスペシャルティコーヒー。',
  },
  {
    id: 'p-002',
    name: 'Colombia Huila',
    price: 1600,
    category: 'coffee',
    stock: 12,
    description: 'バランスの良い甘さとナッツの後味。',
  },
  {
    id: 'p-003',
    name: 'Kenya AA',
    price: 2000,
    category: 'coffee',
    stock: 6,
    description: '明るい酸味と果実感、長い余韻。',
  },
  {
    id: 'p-004',
    name: 'Assam CTC',
    price: 1200,
    category: 'tea',
    stock: 30,
    description: 'ミルクティーに最適な濃厚な紅茶。',
  },
  {
    id: 'p-005',
    name: 'Darjeeling First Flush',
    price: 2400,
    category: 'tea',
    stock: 8,
    description: '春摘みの繊細でマスカテルな香り。',
  },
  {
    id: 'p-006',
    name: 'Chocolate Cookie',
    price: 480,
    category: 'sweets',
    stock: 50,
    description: 'ベルギー産チョコをたっぷり使った焼き菓子。',
  },
  {
    id: 'p-007',
    name: 'Madeleine Box (6個)',
    price: 1280,
    category: 'sweets',
    stock: 20,
    description: 'バターと蜂蜜の香り、定番の貝形焼き菓子。',
  },
]

export function getProduct(id: string): Product | undefined {
  return products.find((p) => p.id === id)
}
