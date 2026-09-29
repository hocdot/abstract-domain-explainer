'''Minimal abstract-domain engines, copied from ``constrained-abstraction``.

Each engine only knows the math of its domain (how a box, zonotope, ... moves
through Linear / ReLU). Explanations for the website live in ``backend.domains``.
'''
from .interval import PerturbInterval

__all__ = ['PerturbInterval']
