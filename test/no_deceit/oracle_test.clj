(ns no-deceit.oracle-test
  "Runs each oracle/cases/*.json against its Clojure twin. The JS module is the
  source of truth (oracle/oracle.test.mjs proves the cases). A case file whose
  namespace has no src/ file yet is skipped, so this passes with 0 ported."
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]
            [clojure.test :refer [deftest is testing]]))

(defn- ns-file [ns-sym]
  (str "src/" (-> (str ns-sym) (str/replace "-" "_") (str/replace "." "/")) ".clj"))

(defn- normalize
  "JSON round-trip so keywords/keyword-keys compare equal to JSON strings."
  [x] (json/parse-string (json/generate-string x)))

(deftest oracle
  (doseq [f (sort (map str (fs/glob "oracle/cases" "*.json")))
          :let [spec (json/parse-string (slurp f) true)
                ns-sym (symbol (get-in spec [:bb :ns]))]]
    (testing (:module spec)
      (if-not (fs/exists? (ns-file ns-sym))
        (println "oracle: skip" (:module spec) "(not ported)")
        (do (require ns-sym)
            (let [f* (ns-resolve ns-sym (symbol (get-in spec [:bb :fn])))]
              (is f* (str "missing fn " (get-in spec [:bb :fn])))
              (doseq [c (:cases spec)]
                (is (= (normalize (:expect c))
                       (normalize (apply f* (:args c))))
                    (str (:module spec) ": " (:name c))))))))))
