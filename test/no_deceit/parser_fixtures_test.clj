(ns no-deceit.parser-fixtures-test
  "Runs fixtures/evidence/cases.json against the evidence parsers you write in
  Babashka (contract: PORTING.md, step 7). Each case is a raw input file and the
  summary JSON the parser must produce. A parser namespace with no src/ file yet
  is skipped, exactly like an unported module in the oracle test."
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]
            [clojure.test :refer [deftest is testing]]
            [clojure.walk :as walk]))

(def ^:private dir "fixtures/evidence/")

(defn- ns-file [ns-sym]
  (str "src/" (-> (str ns-sym) (str/replace "-" "_") (str/replace "." "/")) ".clj"))

(defn- normalize
  "JSON round-trip: keywords equal strings, and a whole double equals an integer."
  [x]
  (walk/postwalk #(if (and (float? %) (== % (Math/rint %)) (not (Double/isInfinite %)))
                    (long %)
                    %)
                 (json/parse-string (json/generate-string x))))

(deftest parser-fixtures
  (let [{:keys [parsers cases]} (json/parse-string (slurp (str dir "cases.json")) true)]
    (doseq [{:keys [name parser input expect]} cases
            :let [{ns-str :ns fn-str :fn} (get parsers (keyword parser))
                  ns-sym (symbol ns-str)]]
      (testing name
        (if-not (fs/exists? (ns-file ns-sym))
          (println "fixtures: skip" name "(" ns-str "not written)")
          (if-let [f (try (require ns-sym) (ns-resolve ns-sym (symbol fn-str))
                          (catch Exception e (println "fixtures: load failed" ns-sym (ex-message e))))]
            (is (= (normalize (json/parse-string (slurp (str dir expect)) true))
                   (normalize (f (slurp (str dir input)))))
                name)
            (is false (str name ": cannot resolve " ns-str "/" fn-str))))))))
