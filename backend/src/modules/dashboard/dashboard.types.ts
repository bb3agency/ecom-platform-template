export type DashboardPeriod = 'today' | '7d' | '30d' | 'custom';
export type DashboardGranularity = 'hour' | 'day' | 'week';

export type DashboardKpisQuery = {
  period?: DashboardPeriod;
  from?: string;
  to?: string;
};

export type DashboardSalesChartQuery = {
  granularity?: DashboardGranularity;
  from?: string;
  to?: string;
};

export type DashboardTopProductsQuery = {
  limit?: number;
  from?: string;
  to?: string;
};

