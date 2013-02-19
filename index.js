
var MyModule = angular.module('MyModule', []);


MyModule.factory('bugzillaService', function ($rootScope, $http)
{
    var sharedBugzillaService = {};

    sharedBugzillaService.credentials = undefined;

    sharedBugzillaService.cleanupBug = function(bug) {
        bug.creation_time = Date.parse(bug.creation_time);
        //bug.last_change_time = Date.parse(bug.last_change_time);

        bug.age = Math.floor((Date.now() - bug.creation_time) / (24 * 60 * 60 * 1000));

        bug.label = "default";
        if (bug.age < 7) {
            bug.label = "success";
        } else if (bug.age < 28) {
            bug.label = "warning";
        } else {
            bug.label = "important";
        }
    };

    sharedBugzillaService.login = function BugzillaService_login(username, password)
    {
        var params = {
            username: username,
            password: password
        };

        $http({url: "https://api-dev.bugzilla.mozilla.org/latest/bug/38", method:"GET", params:params})
            .success(function(data) {
                sharedBugzillaService.credentials = {username: username, password: password};
                $rootScope.$broadcast("BugzillaLoginSuccess", {username:username});
            })
            .error(function(data, status, headers, config){
                $rootScope.$broadcast("BugzillaLoginFailure");
            });
    };

    sharedBugzillaService.logout = function()
    {
        sharedBugzillaService.credentials = undefined;
        $rootScope.$broadcast("BugzillaLogoutSuccess");
    };

    sharedBugzillaService.getBugs = function(options)
    {
        var params = {
            include_fields:"_default"
        };

        if (sharedBugzillaService.credentials) {
            params.username = sharedBugzillaService.credentials.username;
            params.password = sharedBugzillaService.credentials.password;
        }

        $.each(['classification', 'component', 'product', 'id', 'status', 'include_fields'], function(index, value) {
            if (options[value]) {
                params[value] = options[value];
            }
        });

        return $http({url: "https://api-dev.bugzilla.mozilla.org/latest/bug", method:"GET", params:params});
    };

    sharedBugzillaService.isLoggedIn = function() {
        return this.credentials != undefined;
    };

    return sharedBugzillaService;
});

function SigninController($scope, $http, bugzillaService)
{
    $scope.bugzillaService = bugzillaService;
    $scope.loggedIn = false;
    $scope.error = undefined;

    $scope.username = "";
    $scope.password = "";

    $scope.signin = function()
    {
        $scope.error = undefined;
        bugzillaService.login($scope.username, $scope.password);
    };

    $scope.$on("BugzillaLoginSuccess", function() {
        $scope.loggedIn = true;
    });

    $scope.$on("BugzillaLogoutSuccess", function() {
        $scope.loggedIn = false;
    });
}

function PageController($scope, $http, bugzillaService)
{
    $scope.bugzillaService = bugzillaService;
    $scope.loggedIn = false;
    $scope.loading = true;
    $scope.username = undefined;

    $scope.bugs = [];
    $scope.projectReviewBugs = [];
    $scope.blockingBugs = {};

    $scope.$on("BugzillaLoginSuccess", function(event, args) {
        $scope.username = args.username;
        $scope.loggedIn = true;
        $scope.reload();
    });

    $scope.$on("BugzillaLogoutSuccess", function() {
        $scope.loggedIn = false;
    });

    $scope.logout = function()
    {
        $scope.bugzillaService.logout();
    }

    $scope.reload = function()
    {
        // First we get the project review bugs

        var options = {
            //classification:["Client Software", "Components", "Server Software", "Other", "Graveyard"],
            //classification: "Other",
            //id: "825971,825633,821870,821540,818692",
            component:"Project Review",
            product:"mozilla.org",
            status:"NEW",
            include_fields:"id,status,summary,depends_on,creation_time"
        };

        var startTime = Date.now();

        bugzillaService.getBugs(options)
            .success(function(data) {
                $scope.projectReviewBugs = data.bugs;

                // Clean up all the bugs
                for (var i = 0; i < $scope.projectReviewBugs.length; i++) {
                    bugzillaService.cleanupBug($scope.projectReviewBugs[i]);
                }

                // Then we get all the blocking bugs

                var blockingBugIds = [];
                for (var i = 0; i < $scope.projectReviewBugs.length; i++) {
                    var bug = $scope.projectReviewBugs[i];
                    if (bug.depends_on) {
                        for (var j = 0; j < bug.depends_on.length; j++) {
                            blockingBugIds.push(bug.depends_on[j]);
                        }
                    }
                }

                var options = {
                    id: blockingBugIds.join(","),
                    include_fields:"id,status,summary,product,component"
                }

                bugzillaService.getBugs(options)
                    .success(function(data) {
                        console.log("Loading bugs took ", (Date.now() - startTime) / 1000.0);

                        // Store all the blockers in a map
                        for (var i = 0; i < data.bugs.length; i++) {
                            var bug = data.bugs[i];
                            $scope.blockingBugs[bug.id] = bug;
                        }
                        // Loop over all review bugs and replace the dependend bug numbers with real bug records
                        for (var i = 0; i < $scope.projectReviewBugs.length; i++) {
                            var bug = $scope.projectReviewBugs[i];
                            if (bug.depends_on) {
                                for (var j = 0; j < bug.depends_on.length; j++) {
                                    var blockingBugId = bug.depends_on[j];
                                    if ($scope.blockingBugs[blockingBugId]) {
                                        bug.depends_on[j] = $scope.blockingBugs[blockingBugId];
                                    } else {
                                        bug.depends_on[j] = {summary:"Unavailable", id:bug.depends_on[j]};
                                    }
                                }
                            }
                        }
                        // Display all bugs by default
                        $scope.loading = false;
                        $scope.filterBy('all');
                    });

            })
            .error(function(data, status, headers, config) {
                console.log("Error getting bugs", data, status);
            });
    };

    // TODO Do not filter on blocker bugs that are resolved

    $scope.filterBy = function(what)
    {
        $scope.filter_all = undefined;
        $scope.filter_privacy = undefined;
        $scope.filter_security = undefined;
        $scope.filter_legal = undefined;
        $scope.filter_data = undefined;
        $scope.filter_finance = undefined;

        switch (what)
        {
            case 'all': {}
                $scope.filter_all = "active";
                $scope.bugs = _.sortBy($scope.projectReviewBugs, function (bug) { return bug.age; }).reverse();
                break;
            case 'security': {
                var foundBugs = [];
                for (var i = 0; i < $scope.projectReviewBugs.length; i++) {
                    var bug = $scope.projectReviewBugs[i];
                    if (bug.depends_on) {
                        for (var j = 0; j < bug.depends_on.length; j++) {
                            var blockingBug = bug.depends_on[j];
                            if (blockingBug.status == "NEW" && blockingBug.product === 'mozilla.org' && blockingBug.component === "Security Assurance: Review Request") {
                                foundBugs.push(bug);
                            }
                        }
                    }
                }
                $scope.bugs = _.sortBy(foundBugs, function (bug) { return bug.age; }).reverse();
                break;
            }
            case 'legal': {
                $scope.filter_legal = "active";
                var foundBugs = [];
                for (var i = 0; i < $scope.projectReviewBugs.length; i++) {
                    var bug = $scope.projectReviewBugs[i];
                    if (bug.depends_on) {
                        for (var j = 0; j < bug.depends_on.length; j++) {
                            var blockingBug = bug.depends_on[j];
                            if (blockingBug.status == "NEW" && blockingBug.product === 'Legal') {
                                foundBugs.push(bug);
                            }
                        }
                    }
                }
                $scope.bugs = _.sortBy(foundBugs, function (bug) { return bug.age; }).reverse();
                break;
            }
            case 'privacy': {
                $scope.filter_privacy = "active";
                var foundBugs = [];
                for (var i = 0; i < $scope.projectReviewBugs.length; i++) {
                    var bug = $scope.projectReviewBugs[i];
                    if (bug.depends_on) {
                        for (var j = 0; j < bug.depends_on.length; j++) {
                            var blockingBug = bug.depends_on[j];
                            if (blockingBug.status == "NEW" && blockingBug.product === 'Privacy' && blockingBug.component === "Privacy Review") {
                                foundBugs.push(bug);
                            }
                        }
                    }
                }
                $scope.bugs = _.sortBy(foundBugs, function (bug) { return bug.age; }).reverse();
                break;
            }
            case 'data': {
                $scope.filter_data = "active";
                var foundBugs = [];
                for (var i = 0; i < $scope.projectReviewBugs.length; i++) {
                    var bug = $scope.projectReviewBugs[i];
                    if (bug.depends_on) {
                        for (var j = 0; j < bug.depends_on.length; j++) {
                            var blockingBug = bug.depends_on[j];
                            if (blockingBug.status == "NEW" && blockingBug.product === 'Data Safety' && blockingBug.component === "General") {
                                foundBugs.push(bug);
                            }
                        }
                    }
                }
                $scope.bugs = _.sortBy(foundBugs, function (bug) { return bug.age; }).reverse();
                break;
            }
            case 'finance': {
                $scope.filter_finance = "active";
                var foundBugs = [];
                for (var i = 0; i < $scope.projectReviewBugs.length; i++) {
                    var bug = $scope.projectReviewBugs[i];
                    if (bug.depends_on) {
                        for (var j = 0; j < bug.depends_on.length; j++) {
                            var blockingBug = bug.depends_on[j];
                            if (blockingBug.status == "NEW" && blockingBug.product === 'Finance' && blockingBug.component === "Purchase Request Form") {
                                foundBugs.push(bug);
                            }
                        }
                    }
                }
                $scope.bugs = _.sortBy(foundBugs, function (bug) { return bug.age; }).reverse();
                break;
            }
        }
    };
}
