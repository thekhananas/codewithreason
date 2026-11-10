"""Public task clarification for learners who have not understood the problem.

These examples explain the input/output contract. They are independent of the
learner's submission, diagnosed invariant, and hidden execution evidence, and
do not describe the algorithm or reveal a reference implementation.
"""
from __future__ import annotations

import re

from app.models.schemas import ProblemSchema


_EXAMPLES = re.compile(
    r"\b(?:give|show|need|want|provide)(?:\s+[\w']+){0,5}\s+(?:examples?|samples?)\b"
    r"|\b(?:for|with)\s+(?:an?\s+)?examples?\b"
    r"|\b(?:walk|talk)(?:\s+[\w']+){0,10}\s+(?:examples?|samples?)\b"
    r"|^(?:examples?|samples?)(?:\s+please)?[.!?\s]*$",
    re.IGNORECASE,
)
_SMALL_STEP = re.compile(
    r"\bno\s+idea\b|\bidk\b|\b(?:don['’]?t|do\s+not)\s+know\b"
    r"|\bnot\s+sure\b",
    re.IGNORECASE,
)
_CONFUSION = re.compile(
    r"\b(?:don['’]?t|do\s+not|can['’]?t|cannot)\s+(?:understand|get\s+it)\b"
    r"|\bi(?:['’]m|\s+am)\s+(?:confused|lost)\b"
    r"|\bwhat\s+(?:does|do|is)\b.{0,80}\b(?:mean|asking|expected|question|task|output)\b"
    r"|\bexplain\s+(?:the|this)\s+(?:question|problem|task)\b",
    re.IGNORECASE,
)
_DEBUG_FOCUS = re.compile(
    r"\b(?:code|loops?|functions?|variables?|implementation|recursion|recursive|"
    r"pointers?|indexing|condition|syntax|runtime|exceptions?|traceback|bugs?|"
    r"debug(?:ging)?|fail(?:s|ed|ing)?|incorrect|wrong|complexity|tests?)\b",
    re.IGNORECASE,
)
_PUBLIC_TASK_REQUEST = re.compile(
    r"\b(?:problem|task)\s+(?:statement|description|requirements)\b"
    r"|\b(?:understand|explain|clarify)\s+(?:(?:the|this)\s+)?"
    r"(?:problem|task|question)(?=[.!?]|$)"
    r"|\b(?:input|output)(?:\s+and\s+(?:input|output))?\s+(?:mean|means|represent)\b"
    r"|\bwhat\b.{0,40}\b(?:problem|task|question)\s+(?:is\s+)?asking\b"
    r"|\b(?:what|which)\b.{0,30}\b(?:supposed|expected|required)\s+to\s+(?:return|report)\b",
    re.IGNORECASE,
)


# Curated explanatory examples, not values copied from a fuzzing report.
# Each response ends in a concrete comprehension question, not an algorithmic
# instruction. Keep ordinary submissions on the existing ontology probes.
_PUBLIC_EXPLANATIONS = {
    "two-sum-sorted": (
        "The task is to find two numbers at different positions in the sorted list that add up to the target. "
        "Your answer names their positions, counting from 1, rather than the numbers themselves.\n\n"
        "Example: the list is [2, 7, 11, 15] and the target is 9. "
        "The numbers 2 and 7 make 9. They occupy positions 1 and 2, so the expected answer is [1, 2].\n\n"
        "In that example, does the answer [1, 2] describe the values or their positions?"
    ),
    "longest-unique-substring": (
        "The task is to find the longest unbroken piece of the text that contains no repeated character. "
        "Your answer is its length, not the piece of text itself.\n\n"
        "Example: for the text 'abcabcbb', 'abc' has three different characters. "
        "Every longer piece contains a repeat, so the expected answer is 3.\n\n"
        "Why would 'abca' not be an allowed piece?"
    ),
    "rotated-sorted-min": (
        "The task is to report the smallest number in the list. "
        "A rotated list was increasing, then cut at one place with the two pieces swapped.\n\n"
        "Example: [4, 5, 6, 7, 0, 1, 2] is a rotation of [0, 1, 2, 4, 5, 6, 7]. "
        "Its smallest value is 0, so the expected answer is 0. The answer is a value, not a position.\n\n"
        "In this example, is the first number necessarily the smallest?"
    ),
    "house-robber-dp": (
        "The task is to choose houses with the largest possible total value, "
        "without choosing neighboring houses. Your answer is the total, not the house positions.\n\n"
        "Example: the house values are [2, 7, 9, 3, 1]. "
        "Houses 1, 3 and 5 have values 2, 9 and 1 and are not neighbors. "
        "They total 12; no allowed choice gives more, so the expected answer is 12.\n\n"
        "Would choosing houses 2 and 3 obey the no-neighbors rule?"
    ),
    "max-subarray-kadane": (
        "The task is to choose a nonempty, unbroken piece of the list with the largest total. "
        "You cannot skip numbers inside that piece. Your answer is the total.\n\n"
        "Example: for [4, -1, 2, -6, 3], the piece [4, -1, 2] totals 5. "
        "No other allowed piece has a larger total, so the expected answer is 5.\n\n"
        "Would choosing 4 and 2 while skipping the -1 between them be allowed?"
    ),
}

_SMALL_QUESTIONS = {
    "two-sum-sorted": (
        "Let's ignore the code for a moment. The list [2, 7, 11, 15] has 2 in position 1 "
        "and 7 in position 2, counting from 1. Together they make the target 9. "
        "That is why the answer is [1, 2].\n\n"
        "A smaller step: are you being asked to report the numbers, or where they are in the list?"
    ),
    "longest-unique-substring": (
        "Let's ignore the code for a moment. In the text 'abcabcbb', the piece 'abc' "
        "has length 3 and has no repeated character. The piece 'abca' repeats 'a'.\n\n"
        "A smaller step: which of those two pieces obeys the no-repeated-characters rule?"
    ),
    "rotated-sorted-min": (
        "Let's ignore the code for a moment. In [4, 5, 6, 7, 0, 1, 2], "
        "the smallest value is 0, even though it is not at the front.\n\n"
        "A smaller step: are you being asked for that value, or for its position?"
    ),
    "house-robber-dp": (
        "Let's ignore the code for a moment. For houses [2, 7, 9, 3, 1], "
        "you may choose houses 1, 3 and 5 because no two are next to each other. "
        "Their values total 12.\n\n"
        "A smaller step: could you choose two houses that are next to each other?"
    ),
    "max-subarray-kadane": (
        "Let's ignore the code for a moment. In [4, -1, 2, -6, 3], "
        "[4, -1, 2] is one unbroken piece and its total is 5. "
        "Choosing only 4 and 2 would skip a number in the middle.\n\n"
        "A smaller step: does the task allow skipping a number inside your chosen piece?"
    ),
}


def clarify_public_task(problem: ProblemSchema, user_message: str) -> str | None:
    """Recognize requests for comprehension help without advancing a hint tier.

    Never interpolate learner text into curated output. An unknown problem
    keeps the existing response path rather than receiving a made-up example.
    """
    message = (user_message or "").strip()
    if not message:
        return None
    if _EXAMPLES.search(message):
        return _PUBLIC_EXPLANATIONS.get(problem.problem_id)
    # Uncertainty about a loop or a failing test is still a debugging question.
    # Keep its diagnosed hint/provider path unless the learner explicitly asks
    # to understand the public statement or its input/output contract instead.
    if _DEBUG_FOCUS.search(message) and not _PUBLIC_TASK_REQUEST.search(message):
        return None
    if _SMALL_STEP.search(message):
        return _SMALL_QUESTIONS.get(problem.problem_id)
    if _CONFUSION.search(message):
        return _PUBLIC_EXPLANATIONS.get(problem.problem_id)
    return None
