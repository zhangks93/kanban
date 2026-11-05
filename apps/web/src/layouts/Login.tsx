import { ArrowRight, Layers, ShieldCheck, Sparkles } from 'lucide-react';

export function Login() {
  return (
    <main className="login-layout">
      <section className="login login-card" aria-labelledby="login-title">
        <div className="brand" aria-label="Work 工作平台">
          <span className="login-brand-mark">W</span>
          <span>WORK</span>
        </div>
        <span className="login-eyebrow">团队协作 · 清晰有序</span>
        <h1 id="login-title">把工作，聚焦在一起。</h1>
        <p className="login-description">
          从个人待办到团队看板，让每一项工作都有方向，让每一次协作都有进展。
        </p>
        <a className="login-button primary" href="/auth/feishu/start?next=/my">
          使用飞书登录 <ArrowRight size={16} aria-hidden="true" />
        </a>
        <div className="login-features">
          <span>
            <Layers size={15} aria-hidden="true" />
            团队看板
          </span>
          <span>
            <Sparkles size={15} aria-hidden="true" />
            Agent 协作
          </span>
          <span>
            <ShieldCheck size={15} aria-hidden="true" />
            飞书身份认证
          </span>
        </div>
      </section>
    </main>
  );
}
