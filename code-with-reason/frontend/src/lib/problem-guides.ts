/** Public teaching examples: clarify the task without revealing an algorithm. */
export interface ProblemExample {
  input: Record<string, unknown>;
  output: unknown;
  explanation: string;
}

export interface ProblemGuide {
  task: string;
  input: string;
  returns: string;
  remember?: string;
  examples: readonly ProblemExample[];
}

export const PROBLEM_GUIDES: Readonly<Record<string, ProblemGuide>> = {
  "two-sum-sorted": {
    task: "Choose two different positions in the sorted list whose values add up to the target. Return their positions, with the smaller position first.",
    input: "A sorted list of integers called nums, and a target total.",
    returns:
      "Two positions, not the two values. Count positions starting at 1.",
    remember:
      "The values may be equal, but you must use different positions. Exactly one valid pair exists.",
    examples: [
      {
        input: { nums: [2, 7, 11, 15], target: 9 },
        output: [1, 2],
        explanation:
          "2 + 7 = 9. These values are at positions 1 and 2, so return [1, 2].",
      },
      {
        input: { nums: [1, 3, 4, 8], target: 12 },
        output: [3, 4],
        explanation:
          "4 + 8 = 12. The values are 4 and 8, but their positions are 3 and 4.",
      },
    ],
  },
  "longest-unique-substring": {
    task: "Find the longest stretch of neighboring characters with no repeated character. Return how many characters it contains.",
    input: "A string called s. It can also be empty.",
    returns: "The length of the longest valid stretch, not the stretch itself.",
    remember:
      "The characters must stay next to each other in the original string. You cannot skip characters.",
    examples: [
      {
        input: { s: "abcabcbb" },
        output: 3,
        explanation:
          '"abc" contains 3 different characters. Any longer stretch in this string repeats a character.',
      },
      {
        input: { s: "pwwkew" },
        output: 3,
        explanation:
          '"wke" is a valid stretch of length 3. "pwke" does not count because its characters are not all next to each other.',
      },
    ],
  },
  "rotated-sorted-min": {
    task: "A sorted list may have been cut at one point and its two pieces swapped. Find and return the smallest number in the resulting list.",
    input: "A nonempty list called nums, with no repeated values.",
    returns: "The smallest value, not its position.",
    remember: "The list might not have been rotated at all.",
    examples: [
      {
        input: { nums: [4, 5, 6, 7, 0, 1, 2] },
        output: 0,
        explanation:
          "The smallest number is 0. Return the value 0, even though it is not at the start of the list.",
      },
      {
        input: { nums: [1, 2, 3, 4] },
        output: 1,
        explanation: "This list is already sorted. Its smallest value is 1.",
      },
    ],
  },
  "house-robber-dp": {
    task: "Each number is the amount in a house along a street. Choose houses with the largest possible total, without choosing two houses next to each other.",
    input: "A list of nonnegative amounts called nums, in street order.",
    returns: "The largest total you can collect, not the house positions.",
    remember:
      "The street is a line, not a circle. Choosing no house is allowed.",
    examples: [
      {
        input: { nums: [1, 2, 3, 1] },
        output: 4,
        explanation:
          "Choose the first and third houses: 1 + 3 = 4. They are not neighbors.",
      },
      {
        input: { nums: [2, 7, 9, 3, 1] },
        output: 12,
        explanation:
          "Choose the first, third and fifth houses: 2 + 9 + 1 = 12. No two chosen houses are next to each other.",
      },
    ],
  },
  "max-subarray-kadane": {
    task: "Choose a nonempty stretch of neighboring numbers whose sum is as large as possible. Return that sum.",
    input:
      "A nonempty list of integers called nums. Some or all numbers may be negative.",
    returns: "The largest sum, not the chosen numbers or their positions.",
    remember:
      "You must choose at least one number, and you cannot skip numbers inside your chosen stretch.",
    examples: [
      {
        input: { nums: [-2, 1, -3, 4, -1, 2, 1, -5, 4] },
        output: 6,
        explanation:
          "The neighboring numbers [4, -1, 2, 1] add up to 6. No other continuous stretch has a larger sum.",
      },
      {
        input: { nums: [-3, -2, -5] },
        output: -2,
        explanation:
          "Choose just [-2]. You cannot return 0 by choosing nothing, because the stretch must be nonempty.",
      },
    ],
  },
};

const LEGACY_IDS: Readonly<Record<string, string>> = {
  two_sum_sorted: "two-sum-sorted",
  longest_unique_substring: "longest-unique-substring",
  find_min_rotated: "rotated-sorted-min",
  max_subarray_kadane: "max-subarray-kadane",
};

export function getProblemGuide(problemId: string): ProblemGuide | undefined {
  const canonicalId = Object.prototype.hasOwnProperty.call(
    LEGACY_IDS,
    problemId,
  )
    ? LEGACY_IDS[problemId]
    : problemId;
  return Object.prototype.hasOwnProperty.call(PROBLEM_GUIDES, canonicalId)
    ? PROBLEM_GUIDES[canonicalId]
    : undefined;
}
