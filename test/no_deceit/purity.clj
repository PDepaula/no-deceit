(ns no-deceit.purity
  "Purity lint: core namespaces (src/) may not require impure libs or read env."
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def forbidden
  ["babashka.fs" "babashka.process" "clojure.java.io" "System/getenv"])

(defn violations [root]
  (for [f (map str (fs/glob root "**.clj"))
        [n line] (map-indexed vector (str/split-lines (slurp f)))
        bad forbidden
        :when (str/includes? line bad)]
    (str f ":" (inc n) ": forbidden " bad)))

(defn lint
  "Prints violations; returns exit code."
  [root]
  (let [vs (violations root)]
    (run! println vs)
    (if (seq vs) 1 0)))
