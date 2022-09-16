import { BigNumber, utils } from 'ethers';

// Time
export const ONE_HOUR_IN_SECONDS = 60 * 60;
export const ONE_DAY_IN_SECONDS = ONE_HOUR_IN_SECONDS * 24;
export const ONE_WEEK_IN_SECONDS = ONE_DAY_IN_SECONDS * 7;
export const ONE_YEAR_IN_SECONDS = ONE_DAY_IN_SECONDS * 365.25;

// Percentages
// BPS
export const ONE_PERCENT_IN_BPS = 100;
export const FIVE_PERCENT_IN_BPS = ONE_PERCENT_IN_BPS * 5;
export const TEN_PERCENT_IN_BPS = ONE_PERCENT_IN_BPS * 10;
export const ONE_HUNDRED_PERCENT_IN_BPS = 10000;
// WEI
export const ONE_HUNDRED_PERCENT_IN_WEI = utils.parseEther('1');
export const TEN_PERCENT_IN_WEI = ONE_HUNDRED_PERCENT_IN_WEI.div(10);
export const FIVE_PERCENT_IN_WEI = ONE_HUNDRED_PERCENT_IN_WEI.div(20);
export const ONE_PERCENT_IN_WEI = ONE_HUNDRED_PERCENT_IN_WEI.div(100);
export const ONE_ONE_HUNDREDTH_PERCENT_IN_WEI = ONE_HUNDRED_PERCENT_IN_WEI.div(10000);

// Dummy Addresses
export const SPECIFIC_ASSET_REDEMPTION_DUMMY_FORFEIT_ADDRESS = '0x000000000000000000000000000000000000aaaa';
export const LIB_INIT_GENERIC_DUMMY_ADDRESS = '0x0000000000000000000000000000000000009999';

export const SHARES_UNIT = utils.parseEther('1');

export const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
// some tokens, e.g., Enzyme vault shares, do not allow transfers to the zero address
export const NULL_ADDRESS_ALT = '0x0000000000000000000000000000000000000001';

export const MAX_UINT128 = BigNumber.from(2).pow(128).sub(1);
