/**
 * SubscriptionScreen —— 续费 / 套餐选择
 */
import { Check, Zap, Target, Rocket, Gem, Crown, Star } from 'lucide-react';

interface Plan {
  key: string;
  name: string;
  desc: string;
  price: number;
  originalPrice: number;
  discount: string;
  duration: string;
  popular?: boolean;
  icon: any;
  color: string;
  perks: string[];
}

const PLANS: Plan[] = [
  { key: '1h', name: '尝鲜体验', desc: '适合快速练习', price: 60, originalPrice: 90, discount: '6.7 折', duration: '1 小时', icon: Zap, color: '#6366F1', perks: ['1 小时面试时长', 'AI 实时建议', '面试历史记录', '基础赛道支持'] },
  { key: '2h', name: '进阶特训', desc: '深度模拟面试', price: 100, originalPrice: 160, discount: '6.3 折', duration: '2 小时', icon: Target, color: '#8B5CF6', perks: ['2 小时面试时长', 'AI 实时建议', '面试历史记录', '全赛道支持'] },
  { key: '4h', name: '高效冲刺', desc: '密集备战方案', price: 188, originalPrice: 300, discount: '6.3 折', duration: '4 小时', icon: Rocket, color: '#4F46E5', popular: true, perks: ['4 小时面试时长', 'AI 实时建议', '面试历史记录', '全赛道支持', '优先队列'] },
  { key: 'monthly', name: '包月畅练', desc: '不限时长随心练', price: 400, originalPrice: 800, discount: '5 折', duration: '/ 月', icon: Gem, color: '#7C3AED', perks: ['30 天不限时长', 'AI 实时建议', '面试历史记录', '全赛道支持', '优先队列', '专属客服'] },
  { key: 'quarterly', name: '季度进阶', desc: '系统化面试训练', price: 800, originalPrice: 1888, discount: '4.2 折', duration: '/ 季', icon: Crown, color: '#A855F7', perks: ['90 天不限时长', 'AI 实时建议', '面试历史记录', '全赛道支持', '优先队列', '专属客服', '模拟面试报告'] },
  { key: 'yearly', name: '年度王者', desc: '终极面试解决方案', price: 2000, originalPrice: 7200, discount: '2.8 折', duration: '/ 年', icon: Star, color: '#D946EF', perks: ['365 天不限时长', 'AI 实时建议', '面试历史记录', '全赛道支持', '最优先队列', '1v1 专属客服', '模拟面试报告', '简历深度优化'] },
];

interface Props { onClose: () => void; }

export default function SubscriptionScreen({ onClose }: Props) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center z-50 overflow-y-auto py-8 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-[#141416] rounded-2xl shadow-xl shadow-black/10 max-w-5xl w-full mx-4 my-auto border border-zinc-200 dark:border-zinc-800" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-200 dark:border-zinc-800">
          <div>
            <h2 className="text-lg font-extrabold text-zinc-900 dark:text-white">
              选择适合你的 <span className="bg-gradient-to-r from-indigo-500 to-violet-500 bg-clip-text text-transparent">面试方案</span>
            </h2>
            <p className="text-sm text-zinc-500 mt-1">每一次练习，都在靠近你的 dream offer</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {PLANS.map(plan => {
            const Icon = plan.icon;
            return (
              <div key={plan.key}
                className={`relative rounded-2xl p-5 border-2 flex flex-col transition-shadow hover:shadow-md ${
                  plan.popular ? 'border-indigo-300 dark:border-indigo-500 shadow-sm ring-1 ring-indigo-100 dark:ring-indigo-500/10' : 'border-zinc-200 dark:border-zinc-800'
                }`}>
                {plan.popular && (
                  <span className="absolute top-0 right-0 px-3 py-1 text-[10px] font-bold text-white rounded-bl-xl" style={{ backgroundColor: plan.color }}>
                    最受欢迎
                  </span>
                )}
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: plan.color + '15', color: plan.color }}>
                    <Icon className="w-5 h-5" strokeWidth={1.5} />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-zinc-900 dark:text-white">{plan.name}</div>
                    <div className="text-[11px] text-zinc-400">{plan.desc}</div>
                  </div>
                </div>

                <div className="flex items-baseline justify-between mb-4">
                  <div className="flex items-baseline">
                    <span className="text-base font-bold text-zinc-500">¥</span>
                    <span className="text-3xl font-extrabold text-zinc-900 dark:text-white tracking-tight">{plan.price}</span>
                    <span className="text-xs text-zinc-400 ml-1">{plan.duration}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-400 line-through">¥{plan.originalPrice}</span>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold text-white" style={{ backgroundColor: plan.color }}>{plan.discount}</span>
                  </div>
                </div>

                <div className="flex-1 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800 p-3.5 space-y-2 mb-4">
                  {plan.perks.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" strokeWidth={2.5} />
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">{p}</span>
                    </div>
                  ))}
                </div>

                <button
                  className="w-full h-10 rounded-xl text-[13px] font-bold text-white tracking-wide hover:opacity-90 transition-opacity shadow-sm"
                  style={{ backgroundColor: plan.color }}>
                  立即订阅
                </button>
              </div>
            );
          })}
        </div>

        <div className="px-6 pb-6 text-center text-[11px] text-zinc-400">
          所有套餐一经购买立即生效 · 暂不支持退款
        </div>
      </div>
    </div>
  );
}
