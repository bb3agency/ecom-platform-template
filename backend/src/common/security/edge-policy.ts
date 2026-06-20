export type EdgeRouteClass = 'auth' | 'checkout' | 'admin' | 'catalog' | 'webhook' | 'cart' | 'health' | 'default';

export type EdgePolicyRule = {
  className: EdgeRouteClass;
  appLimitPerMinute: number;
  edgeRatePerMinute: number;
  edgeBurst: number;
  action: 'allow' | 'challenge' | 'block';
  escalation?: {
    challengeThresholdPerMinute: number;
    temporaryBlockSeconds: number;
  };
};

export const edgePolicyRules: Record<EdgeRouteClass, EdgePolicyRule> = {
  auth: {
    className: 'auth',
    appLimitPerMinute: 12,
    edgeRatePerMinute: 20,
    edgeBurst: 8,
    action: 'challenge',
    escalation: {
      challengeThresholdPerMinute: 8,
      temporaryBlockSeconds: 900
    }
  },
  checkout: { className: 'checkout', appLimitPerMinute: 30, edgeRatePerMinute: 35, edgeBurst: 12, action: 'allow' },
  admin: { className: 'admin', appLimitPerMinute: 60, edgeRatePerMinute: 60, edgeBurst: 15, action: 'challenge' },
  catalog: { className: 'catalog', appLimitPerMinute: 300, edgeRatePerMinute: 240, edgeBurst: 40, action: 'allow' },
  webhook: { className: 'webhook', appLimitPerMinute: 400, edgeRatePerMinute: 300, edgeBurst: 30, action: 'allow' },
  cart: { className: 'cart', appLimitPerMinute: 90, edgeRatePerMinute: 90, edgeBurst: 20, action: 'allow' },
  health: { className: 'health', appLimitPerMinute: 30, edgeRatePerMinute: 60, edgeBurst: 5, action: 'allow' },
  default: { className: 'default', appLimitPerMinute: 120, edgeRatePerMinute: 90, edgeBurst: 20, action: 'allow' }
};

export function getEdgeRule(routeClass: EdgeRouteClass): EdgePolicyRule {
  return edgePolicyRules[routeClass];
}
