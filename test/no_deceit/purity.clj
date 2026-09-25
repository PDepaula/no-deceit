(ns no-deceit.purity
  "Purity lint: core namespaces (src/) may only require pure libs, may not
  :import, and may not call clock/env/fs/process. Reads forms, not lines, so
  comments and docstrings never count."
  (:require [babashka.fs :as fs]
            [clojure.string :as str]
            [edamame.core :as e]))

(def allowed-libs
  #{"clojure.core" "clojure.string" "clojure.set" "clojure.walk" "clojure.edn"})

(def impure-classes #{"System" "Runtime" "Thread" "Process" "ProcessBuilder"})

(def impure-fns
  #{"slurp" "spit" "load" "load-file" "load-reader" "file-seq" "line-seq" "read-line"})

(defn- allowed-lib? [lib]
  (or (contains? allowed-libs lib) (str/starts-with? lib "no-deceit.")))

(defn- libspec-libs
  "Lib names in one :require/:use entry, expanding prefix lists."
  [spec]
  (cond
    (symbol? spec) [(str spec)]
    (and (sequential? spec) (symbol? (first spec)))
    (let [[head & more] spec]
      (if (and (seq more) (not-any? keyword? more))
        (mapcat #(map (partial str head ".") (libspec-libs %)) more)
        [(str head)]))
    :else []))

(defn- ns-violations [ns-form]
  (for [clause (filter sequential? ns-form)
        :let [k (first clause)]
        v (case k
            (:require :use) (for [lib (mapcat libspec-libs (rest clause))
                                  :when (not (allowed-lib? lib))]
                              (str "require " lib))
            :import [(str "import " (pr-str (vec (rest clause))))]
            [])]
    [(meta clause) v]))

(defn- symbol-violation [s]
  (let [n (namespace s) nm (name s) bare (str/replace nm #"\.$" "")]
    (when (if n
            (or (contains? impure-classes n)
                (and (str/includes? n ".") (not (allowed-lib? n)))
                (and (= "clojure.core" n) (contains? impure-fns nm)))
            (or (contains? impure-fns nm)
                (contains? impure-classes bare)
                (and (not (str/starts-with? nm ".")) (str/includes? bare "."))))
      (str s))))

(defn- body-violations [form]
  (for [s (tree-seq coll? seq form)
        :when (symbol? s)
        :let [v (symbol-violation s)]
        :when v]
    [(meta s) v]))

(defn- file-violations [f]
  (try
    (let [forms (e/parse-string-all (slurp f)
                                    {:all true
                                     :auto-resolve (fn [a] (if (= :current a) 'user a))})]
      (mapcat #(if (and (seq? %) (= 'ns (first %)))
                 (ns-violations %)
                 (body-violations %))
              forms))
    (catch Exception ex [[nil (str "unreadable: " (ex-message ex))]])))

(defn violations [root]
  (for [f (map str (fs/glob root "**.clj"))
        [{:keys [row]} v] (file-violations f)]
    (str f ":" (or row "?") ": forbidden " v)))

(defn lint
  "Prints violations; returns exit code."
  [root]
  (let [vs (violations root)]
    (run! println vs)
    (if (seq vs) 1 0)))
