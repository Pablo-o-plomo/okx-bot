"""BCS commission helper for documentation/prototyping.

Main bot implementation uses src/bcs/commission.ts. This Python module mirrors
basic defaults for quick manual checks.
"""

from dataclasses import dataclass


@dataclass
class BcsCommissionConfig:
    monthly_service_fee: float = 299.0
    securities_fee_percent: float = 0.04
    currency_fee_percent: float = 0.04
    extra_fx_buy_fee_percent: float = 0.1
    futures_fee_rub: float = 1.2
    options_max_fee_percent: float = 1.0


def calculate_commission(
    instrument_type: str,
    turnover_rub: float,
    quantity: float = 1,
    is_currency_buy: bool = False,
    cfg: BcsCommissionConfig = BcsCommissionConfig(),
) -> float:
    if instrument_type == "future":
        return cfg.futures_fee_rub * quantity
    if instrument_type == "option":
        return min(cfg.futures_fee_rub * quantity, turnover_rub * cfg.options_max_fee_percent / 100)
    if instrument_type == "currency":
        fee = turnover_rub * cfg.currency_fee_percent / 100
        if is_currency_buy:
            fee += turnover_rub * cfg.extra_fx_buy_fee_percent / 100
        return fee
    return turnover_rub * cfg.securities_fee_percent / 100
