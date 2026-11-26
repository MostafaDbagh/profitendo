"""Numeric bounds shared by legacy HTTP and spreadsheet inputs."""
import math
from decimal import Decimal, InvalidOperation
from fractions import Fraction
from typing import Annotated

from fastapi import HTTPException
from pydantic import BeforeValidator, Field

MIN_STOCK_QUANTITY = -(2**63)
MAX_STOCK_QUANTITY = 2**63 - 1


def bounded_stock(current, delta):
    """Add in exact decimal units, then select a lossless legacy BSON numeric type."""
    try:
        values = (Decimal(str(current)), Decimal(str(delta)))
    except (ValueError, InvalidOperation):
        raise HTTPException(422, "Invalid stock quantity") from None
    for value in values:
        if not value.is_finite() or value.copy_abs() > MAX_STOCK_QUANTITY - MIN_STOCK_QUANTITY:
            raise HTTPException(422, "Quantity exceeds the supported range")
        if value and value.copy_abs() < Decimal("5e-324"):
            raise HTTPException(422, "Fractional quantity exceeds the supported precision")
    # Decimal zero can carry an arbitrary exponent. Skip it before rational conversion.
    result = sum(Fraction(value) for value in values if value)
    if not MIN_STOCK_QUANTITY <= result <= MAX_STOCK_QUANTITY:
        raise HTTPException(422, "Resulting quantity exceeds the supported 64-bit integer range")
    if result.denominator == 1:
        return result.numerator
    stored = float(result)
    if Fraction(str(stored)) != result:
        raise HTTPException(422, "Resulting fractional quantity exceeds the supported precision")
    return stored


def nonnegative_decimal(value):
    if isinstance(value, bool) or (isinstance(value, float) and value == 0 and math.copysign(1, value) < 0):
        raise ValueError("Expected a nonnegative finite number")
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError("Expected a nonnegative finite number") from None
    if not number.is_finite() or number < 0:
        raise ValueError("Expected a nonnegative finite number")
    return number


def _nonnegative_input(value):
    # JSON decoding may already have converted a large exponent to infinity.
    # FastAPI cannot serialize a raw nonfinite float as validation-error input.
    if isinstance(value, float) and not math.isfinite(value):
        raise HTTPException(422, "Expected a nonnegative finite number")
    return nonnegative_decimal(value)


def _finite_money(value):
    number = float(_nonnegative_input(value))
    if not math.isfinite(number):
        raise ValueError("Amount exceeds the supported range")
    return number or 0.0


def _stock_quantity(value):
    number = _nonnegative_input(value)
    if number > MAX_STOCK_QUANTITY or number != number.to_integral_value():
        raise ValueError("Expected a whole quantity within the supported stock range")
    return int(number)


NonnegativeStockQuantity = Annotated[int, BeforeValidator(_stock_quantity)]
NonnegativeMoney = Annotated[float, Field(ge=0, allow_inf_nan=False), BeforeValidator(_finite_money)]
