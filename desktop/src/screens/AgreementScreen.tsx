/**
 * AgreementScreen —— 服务协议 / 隐私政策
 */
import { FileText } from 'lucide-react';

const SERVICE_AGREEMENT = `AI面试助手 服务协议

最后更新：2026年7月

一、服务说明
AI面试助手（以下简称"本服务"）是一款基于人工智能技术的面试辅助工具，提供实时语音转写、AI答案生成、面试记录管理等功能。本服务仅供个人学习和面试准备使用。

二、免责声明
1. 本服务生成的AI回答仅供参考，不构成任何形式的职业建议或承诺。
2. 用户应自行判断AI生成内容的准确性和适用性，本服务不对因使用AI回答而产生的任何后果承担责任。

三、用户义务
1. 用户不得利用本服务进行任何违法活动。
2. 用户不得在未经允许的情况下录制、传播他人的面试内容。

四、知识产权
本服务的软件代码、界面设计、算法模型等知识产权归开发者所有。用户生成的内容（面试记录、简历等）归用户本人所有。

五、协议变更
我们保留随时修改本协议的权利。重大变更将通过应用内通知的方式告知用户。

六、联系方式
如有疑问，请联系：ai-interview@qq.com`;

const PRIVACY_POLICY = `AI面试助手 隐私政策

最后更新：2026年7月

一、信息收集
我们收集以下信息以提供服务：
1. 邮箱地址：用于账号注册和登录
2. 面试语音：用于实时转写（仅在面试过程中处理，不长期存储）
3. 简历文件：用于生成自我介绍和优化建议
4. 面试历史记录：包括转写文本和AI回答

二、信息使用
收集的信息仅用于：
1. 提供实时语音转写和AI回答生成
2. 优化面试建议和简历分析
3. 改善服务质量

三、数据存储
1. 用户数据存储在安全的云服务器上
2. 语音数据仅在面试过程中实时处理，不会长期保存
3. 面试记录和简历文件由用户自行管理，用户可随时删除

四、第三方服务
本服务使用以下第三方服务：
1. DeepSeek AI：用于生成面试回答和内容优化
2. 火山引擎：用于语音识别
3. QQ邮箱：用于发送验证码

五、用户权利
1. 用户可随时查看、修改、删除自己的个人数据
2. 用户可随时注销账号，注销后所有数据将被永久删除`;

interface Props { type: 'service' | 'privacy'; onClose: () => void; }

export default function AgreementScreen({ type, onClose }: Props) {
  const title = type === 'service' ? '服务协议' : '隐私政策';
  const content = type === 'service' ? SERVICE_AGREEMENT : PRIVACY_POLICY;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-[#141416] rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 max-w-lg w-full mx-4 max-h-[80vh] flex flex-col animate-[scaleIn_150ms_ease-out]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <FileText className="w-5 h-5 text-indigo-500" strokeWidth={1.5}/>
            <h2 className="text-base font-bold text-zinc-900 dark:text-white">{title}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <pre className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed whitespace-pre-wrap font-sans">{content}</pre>
          <p className="text-xs text-zinc-400 mt-6">AI面试助手 v1.0.0</p>
        </div>
      </div>
    </div>
  );
}
