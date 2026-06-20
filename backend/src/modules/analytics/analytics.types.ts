export type AnalyticsGranularity = 'hour' | 'day' | 'week';

export type AnalyticsRevenueQuery = {
  from?: string;
  to?: string;
  granularity?: AnalyticsGranularity;
};

export type AnalyticsFunnelQuery = {
  from?: string;
  to?: string;
};

export type AnalyticsCategoryBreakdownQuery = {
  from?: string;
  to?: string;
};

export type AnalyticsShippingProviderQuery = {
  from?: string;
  to?: string;
};

