(ns no-deceit.oracle-test
  "Runs each oracle/cases/*.json against its Clojure twin. The JS module is the
  source of truth (oracle/oracle.test.mjs proves the cases). A case file whose
  namespace has no src/ file yet is skipped, so this passes with 0 ported."
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]
            [clojure.test :refer [deftest is testing]]
            [clojure.walk :as walk]))

(defn- ns-file [ns-sym]
  (str "src/" (-> (str ns-sym) (str/replace "-" "_") (str/replace "." "/")) ".clj"))

(defn- normalize
  "JSON round-trip so keywords/keyword-keys compare equal to JSON strings, and
  whole doubles become longs because JSON (like JS) has one number type."
  [x]
  (walk/postwalk #(if (and (float? %) (== % (Math/rint %)) (not (Double/isInfinite %)))
                    (long %)
                    %)
                 (json/parse-string (json/generate-string x))))

(deftest oracle
  (doseq [f (sort (map str (fs/glob "oracle/cases" "*.json")))
          :let [spec (json/parse-string (slurp f) true)
                ns-sym (symbol (get-in spec [:bb :ns]))
                fn-sym (symbol (get-in spec [:bb :fn]))]]
    (testing (:module spec)
      (if-not (fs/exists? (ns-file ns-sym))
        (println "oracle: skip" (:module spec) "(not ported)")
        (if-let [f* (try (require ns-sym) (ns-resolve ns-sym fn-sym)
                         (catch Exception e (println "oracle: load failed" ns-sym (ex-message e))))]
          (doseq [c (:cases spec)]
            (is (= (normalize (:expect c))
                   (normalize (apply f* (:args c))))
                (str (:module spec) ": " (:name c))))
          (is false (str (:module spec) ": cannot resolve " ns-sym "/" fn-sym)))))))
