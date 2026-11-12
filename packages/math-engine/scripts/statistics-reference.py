"""Reference values for packages/math-engine/src/gum/statistics.spec.ts.

    uv run --with mpmath python packages/math-engine/scripts/statistics-reference.py

Prints, at 20 significant digits, the tables the spec carries: erf, the normal
quantile, the regularized incomplete beta function, and Student's t distribution
function and quantile. Everything is computed with mpmath at 60 significant
digits (600 for the normal quantile, whose far tail needs them) and none of it
uses the engine: erf and erfinv are mpmath's, the t tail is the regularized
incomplete beta function in whichever of its two forms converges, and the t
quantile is a bisection on that tail.

The probabilities are the doubles nearest the decimal literals, as the engine
receives them: mpf(float(p)).
"""

from mpmath import mp, mpf, betainc, erf, erfinv, nstr, sqrt

mp.dps = 60


def lit(value):
    return nstr(value, 20, min_fixed=-5, max_fixed=5).replace("e-0", "e-").replace("e+0", "e+")


def t_upper_tail(t, nu):
    """P(T > t) for t >= 0."""
    t, nu = mpf(t), mpf(nu)
    z = t * t / (nu + t * t)
    if z < mpf(1) / 2:
        # 1 - I_z cancels in the tail: the working precision follows the size of the tail.
        mp.dps = 60 + int(float(t * t) / 4) + 20
        value = (1 - betainc(mpf(1) / 2, nu / 2, 0, z, regularized=True)) / 2
        mp.dps = 60
        return +value
    return betainc(nu / 2, mpf(1) / 2, 0, nu / (nu + t * t), regularized=True) / 2


def t_quantile(p, nu):
    """t with P(T <= t) = p, for p > 1/2."""
    target = 1 - mpf(p)
    low, high = mpf(0), mpf(1)
    while t_upper_tail(high, nu) > target:
        low, high = high, high * 2
    for _ in range(230):
        mid = (low + high) / 2
        if t_upper_tail(mid, nu) > target:
            low = mid
        else:
            high = mid
    return (low + high) / 2


def normal_quantile(p):
    mp.dps = 600
    value = sqrt(2) * erfinv(2 * mpf(p) - 1)
    mp.dps = 60
    return +value


print("erf: [x, erf(x)]")
for x in ["1e-10", "0.001", "0.1", "0.5", "1", "1.5", "1.9999", "2", "2.5", "3", "4", "5"]:
    print(f"    [{x}, {lit(erf(mpf(x)))}],")

print("normalQuantile, lower tail: [p, z]")
for p in ["1e-250", "1e-100", "1e-20", "1e-10", "0.001", "0.02", "0.02425", "0.025", "0.1", "0.3", "0.45"]:
    print(f"    [{p}, {lit(normal_quantile(mpf(p)))}],")

print("normalQuantile, upper tail: [p, z]")
for p in ["0.84134474606854293", "0.95", "0.975", "0.97725", "0.99", "0.995", "0.9995", "0.999999"]:
    print(f"    [{p}, {lit(normal_quantile(mpf(float(p))))}],")

print("studentTQuantile: [p, nu, t]")
for nu in ["0.5", "1", "2", "3", "4.6", "10", "50", "1000", "9430", "100000", "100001", "9268196", "10000000", "10000024", "1000000000", "1e15"]:
    for p in ["0.6", "0.841345", "0.975", "0.97725", "0.995", "0.9999"]:
        print(f"    [{p}, {nu}, {lit(t_quantile(mpf(float(p)), mpf(float(nu))))}],")

print("studentTCdf: [t, nu, P(T <= t)]")
for nu in ["0.5", "1", "3", "10", "1000", "100000", "1000000", "1000000000"]:
    for t in ["-40", "-6", "-2", "-1e-4", "-1e-8", "-1e-12", "1e-9", "0.5", "1.7", "1.75", "3"]:
        tail = t_upper_tail(abs(mpf(t)), nu)
        print(f"    [{t}, {nu}, {lit(tail if mpf(t) < 0 else 1 - tail)}],")

print("regularizedIncompleteBeta: [x, a, b, I_x(a, b)]")
for x, a, b in [("0.3", "2.5", "7"), ("0.9", "30", "2"), ("1e-8", "3", "400"), ("0.2", "0.05", "0.5"), ("0.75", "12", "0.5")]:
    print(f"    [{x}, {a}, {b}, {lit(betainc(mpf(a), mpf(b), 0, mpf(float(x)), regularized=True))}],")
