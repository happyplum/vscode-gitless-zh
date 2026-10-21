'use strict';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import * as advancedFormat from 'dayjs/plugin/advancedFormat';
import * as relativeTime from 'dayjs/plugin/relativeTime';
import * as updateLocale from 'dayjs/plugin/updateLocale';

dayjs.extend(advancedFormat.default);
dayjs.extend(relativeTime.default, {
	thresholds: [
		{ l: 's', r: 44, d: 'second' },
		{ l: 'm', r: 89 },
		{ l: 'mm', r: 44, d: 'minute' },
		{ l: 'h', r: 89 },
		{ l: 'hh', r: 21, d: 'hour' },
		{ l: 'd', r: 35 },
		{ l: 'dd', r: 6, d: 'day' },
		{ l: 'w', r: 7 },
		{ l: 'ww', r: 3, d: 'week' },
		{ l: 'M', r: 4 },
		{ l: 'MM', r: 10, d: 'month' },
		{ l: 'y', r: 17 },
		{ l: 'yy', d: 'year' },
	],
});
dayjs.extend(updateLocale.default);

dayjs.updateLocale('zh-cn', {
	relativeTime: {
		future: '%s后',
		past: '%s前',
		s: '几秒',
		m: '1 分钟',
		mm: '%d 分钟',
		h: '1 小时',
		hh: '%d 小时',
		d: '1 天',
		dd: '%d 天',
		w: '1 周',
		ww: '%d 周',
		M: '1 个月',
		MM: '%d 个月',
		y: '1 年',
		yy: '%d 年',
	},
});
dayjs.locale('zh-cn');

const shortLocale = {
	name: 'zh-cn-short',
	weekdays: '星期日_星期一_星期二_星期三_星期四_星期五_星期六'.split('_'),
	months: '一月_二月_三月_四月_五月_六月_七月_八月_九月_十月_十一月_十二月'.split('_'),
	weekStart: 1,
	weekdaysShort: '周日_周一_周二_周三_周四_周五_周六'.split('_'),
	monthsShort: '1月_2月_3月_4月_5月_6月_7月_8月_9月_10月_11月_12月'.split('_'),
	weekdaysMin: '日_一_二_三_四_五_六'.split('_'),
	relativeTime: {
		future: '%s后',
		past: '%s',
		s: '现在',
		m: '1分',
		mm: '%d分',
		h: '1时',
		hh: '%d时',
		d: '1天',
		dd: '%d天',
		w: '1周',
		ww: '%d周',
		M: '1月',
		MM: '%d月',
		y: '1年',
		yy: '%d年',
	},
	formats: {
		LTS: 'HH:mm:ss',
		LT: 'HH:mm',
		L: 'YYYY/MM/DD',
		LL: 'YYYY年M月D日',
		LLL: 'YYYY年M月D日 HH:mm',
		LLLL: 'YYYY年M月D日 dddd HH:mm',
	},
	ordinal: (n: number) => `${n}日`,
};

dayjs.locale('zh-cn-short', shortLocale, true);

export const MillisecondsPerMinute = 60000; // 60 * 1000
export const MillisecondsPerHour = 3600000; // 60 * 60 * 1000
export const MillisecondsPerDay = 86400000; // 24 * 60 * 60 * 1000

export interface DateFormatter {
	fromNow(locale?: string): string;
	format(format: string): string;
}

export function getFormatter(date: Date): DateFormatter {
	const formatter = dayjs(date);
	return {
		fromNow: function (locale?: string) {
			return (locale ? formatter.locale(locale) : formatter).fromNow();
		},
		format: function (format: string) {
			return formatter.format(format);
		},
	};
}
