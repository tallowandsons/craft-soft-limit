<?php

namespace tallowandsons\softlimit\models;

use Craft;
use craft\base\Model;

/**
 * Limit model
 */
class Limit extends Model
{
    /**
     * Full marker regex to find [soft-limit:...]
     */
    public const FULL_MARKER_REGEX = '/\[soft-limit:\s*([^\]]+)\]/i';

    /**
     * Inner value regex for "100", "100c", or "100w"
     */
    public const INNER_VALUE_REGEX = '/^\s*(\d+)\s*([cw])?\s*$/i';
    /**
     * The upper bound value for the limit, e.g. 150.
     */
    public int $maxLimit;

    /**
     * Measurement mode: 'chars' or 'words'. Defaults to 'chars'.
     */
    public string $mode = 'chars';

    /**
     * Validation rules for the model.
     */
    public function rules(): array
    {
        return [
            [['maxLimit'], 'required'],
            [['maxLimit'], 'integer', 'min' => 1, 'max' => 100000],
            [['mode'], 'in', 'range' => ['chars', 'words']],
        ];
    }

    /**
     * Parse a marker inner like "100", "100c", or "100w" into a Limit instance.
     */
    public static function fromInner(string $inner): ?self
    {
        if (!preg_match(self::INNER_VALUE_REGEX, $inner, $m)) {
            return null;
        }

        $number = (int) $m[1];
        $modeChar = isset($m[2]) ? strtolower($m[2]) : 'c';
        $mode = $modeChar === 'w' ? 'words' : 'chars';

        $limit = new self([
            'maxLimit' => $number,
            'mode' => $mode,
        ]);

        return $limit;
    }

    /**
     * Parse the first [soft-limit:...] marker from instructions into a Limit instance.
     * Returns null if none found or if inner is invalid.
     */
    public static function fromInstructions(?string $instructions): ?self
    {
        if (!$instructions) {
            return null;
        }

        if (preg_match(self::FULL_MARKER_REGEX, $instructions, $m)) {
            $inner = trim($m[1]);
            return self::fromInner($inner);
        }

        return null;
    }

    /**
     * Scan all [soft-limit:...] markers in instructions.
     * Returns an array of ['full' => string, 'inner' => string].
     */
    public static function scanInstructions(?string $instructions): array
    {
        if (!$instructions) {
            return [];
        }

        $matches = [];
        preg_match_all(self::FULL_MARKER_REGEX, $instructions, $matches, PREG_SET_ORDER);

        $results = [];
        foreach ($matches as $m) {
            $results[] = [
                'full' => $m[0],
                'inner' => trim($m[1]),
            ];
        }
        return $results;
    }
}
