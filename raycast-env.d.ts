/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Habitify API Key - Create it in Habitify Settings > API. Required for all commands. */
  "apiKey": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `index` command */
  export type Index = ExtensionPreferences & {}
  /** Preferences accessible in the `due-now` command */
  export type DueNow = ExtensionPreferences & {}
  /** Preferences accessible in the `current-time-of-day` command */
  export type CurrentTimeOfDay = ExtensionPreferences & {}
  /** Preferences accessible in the `search` command */
  export type Search = ExtensionPreferences & {}
  /** Preferences accessible in the `areas` command */
  export type Areas = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `index` command */
  export type Index = {}
  /** Arguments passed to the `due-now` command */
  export type DueNow = {}
  /** Arguments passed to the `current-time-of-day` command */
  export type CurrentTimeOfDay = {}
  /** Arguments passed to the `search` command */
  export type Search = {}
  /** Arguments passed to the `areas` command */
  export type Areas = {}
}

